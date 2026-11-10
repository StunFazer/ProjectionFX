using System;
using System.Threading;
using Unity.Mathematics;
using Unity.InferenceEngine;
using UnityEngine;
using ProjectionFX.Math;

namespace ProjectionFX.Tracking
{
    public sealed class SentisHandTracker : IDisposable
    {
        public ModelAsset HandDetectorAsset;
        public ModelAsset HandLandmarkerAsset;
        public float ScoreThreshold = 0.5f;

        const int k_NumAnchors = 2016;
        const int k_NumKeypoints = 21;
        const int detectorInputSize = 192;
        const int landmarkerInputSize = 224;

        float[] m_Anchors;
        Worker m_DetectorWorker;
        Worker m_LandmarkerWorker;
        Tensor<float> m_DetectorInput;
        Tensor<float> m_LandmarkerInput;

        readonly OneEuroFilterBank m_Filters = new OneEuroFilterBank(k_NumKeypoints * 3);
        public OneEuroParams FilterParams = OneEuroParams.Default;

        TrackedHand m_HandState;
        public TrackedHand HandState => m_HandState;

        bool m_IsRunning;

        public void Initialize(ModelAsset detectorModel, ModelAsset landmarkerModel)
        {
            HandDetectorAsset = detectorModel;
            HandLandmarkerAsset = landmarkerModel;

            m_Anchors = BlazeAnchors.Generate(detectorInputSize, BlazeAnchors.HandStrides);

            if (HandDetectorAsset != null)
            {
                var detectorModelRuntime = ModelLoader.Load(HandDetectorAsset);
                var graph = new FunctionalGraph();
                var input = graph.AddInput(detectorModelRuntime, 0);
                var outputs = Functional.Forward(detectorModelRuntime, input);
                var boxes = outputs[0];
                var scores = outputs[1];
                var filtered = BlazeUtils.ArgMaxFiltering(boxes, scores);
                detectorModelRuntime = graph.Compile(filtered.Item1, filtered.Item2, filtered.Item3);
                m_DetectorWorker = new Worker(detectorModelRuntime, BackendType.GPUCompute);
            }

            if (HandLandmarkerAsset != null)
            {
                var landmarkerModelRuntime = ModelLoader.Load(HandLandmarkerAsset);
                m_LandmarkerWorker = new Worker(landmarkerModelRuntime, BackendType.GPUCompute);
            }

            m_DetectorInput = new Tensor<float>(new TensorShape(1, detectorInputSize, detectorInputSize, 3));
            m_LandmarkerInput = new Tensor<float>(new TensorShape(1, landmarkerInputSize, landmarkerInputSize, 3));

            m_HandState.Joints = new TrackedJoint[k_NumKeypoints];
        }

        public async Awaitable ProcessFrameAsync(Texture texture, float deltaTime)
        {
            if (m_DetectorWorker == null || m_LandmarkerWorker == null || texture == null)
                return;

            if (m_IsRunning) return;
            m_IsRunning = true;

            try
            {
                float textureWidth = texture.width;
                float textureHeight = texture.height;
                float size = Mathf.Max(textureWidth, textureHeight);

                float scale = size / (float)detectorInputSize;
                var M = BlazeUtils.mul(
                    BlazeUtils.TranslationMatrix(0.5f * (new Vector2(textureWidth, textureHeight) + new Vector2(-size, size))),
                    BlazeUtils.ScaleMatrix(new Vector2(scale, -scale))
                );

                BlazeUtils.SampleImageAffine(texture, m_DetectorInput, M);
                m_DetectorWorker.Schedule(m_DetectorInput);

                var outputIdxAwaitable = (m_DetectorWorker.PeekOutput(0) as Tensor<int>).ReadbackAndCloneAsync();
                var outputScoreAwaitable = (m_DetectorWorker.PeekOutput(1) as Tensor<float>).ReadbackAndCloneAsync();
                var outputBoxAwaitable = (m_DetectorWorker.PeekOutput(2) as Tensor<float>).ReadbackAndCloneAsync();

                using var outputIdx = await outputIdxAwaitable;
                using var outputScore = await outputScoreAwaitable;
                using var outputBox = await outputBoxAwaitable;

                bool passes = outputScore != null && outputScore.shape.length > 0 && outputScore[0] >= ScoreThreshold;
                if (!passes)
                {
                    m_HandState.IsDetected = false;
                    return;
                }

                int idx = outputIdx[0];
                float ax = m_Anchors[idx * 2 + 0];
                float ay = m_Anchors[idx * 2 + 1];
                var anchorPos = detectorInputSize * new float2(ax, ay);

                var boxCentre_TensorSpace = anchorPos + new float2(outputBox[0, 0, 0], outputBox[0, 0, 1]);
                var boxSize_TensorSpace = math.max(outputBox[0, 0, 2], outputBox[0, 0, 3]);

                var kp0 = anchorPos + new float2(outputBox[0, 0, 4], outputBox[0, 0, 5]);
                var kp2 = anchorPos + new float2(outputBox[0, 0, 8], outputBox[0, 0, 9]);
                var delta = kp2 - kp0;
                var len = math.length(delta);
                var up = len > 1e-4f ? delta / len : new float2(0, 1);
                var theta = math.atan2(delta.y, delta.x);
                var rotation = 0.5f * Mathf.PI - theta;

                boxCentre_TensorSpace += 0.5f * boxSize_TensorSpace * up;
                boxSize_TensorSpace *= 2.6f;

                var origin2 = new float2(0.5f * landmarkerInputSize, 0.5f * landmarkerInputSize);
                var scale2 = boxSize_TensorSpace / landmarkerInputSize;
                var M2 = BlazeUtils.mul(M,
                    BlazeUtils.mul(
                        BlazeUtils.mul(
                            BlazeUtils.mul(BlazeUtils.TranslationMatrix(boxCentre_TensorSpace), BlazeUtils.ScaleMatrix(new float2(scale2, -scale2))),
                            BlazeUtils.RotationMatrix(rotation)
                        ),
                        BlazeUtils.TranslationMatrix(-origin2)
                    )
                );

                BlazeUtils.SampleImageAffine(texture, m_LandmarkerInput, M2);
                m_LandmarkerWorker.Schedule(m_LandmarkerInput);

                var landmarksAwaitable = (m_LandmarkerWorker.PeekOutput("Identity") as Tensor<float>).ReadbackAndCloneAsync();
                using var landmarks = await landmarksAwaitable;

                if (landmarks == null)
                {
                    m_HandState.IsDetected = false;
                    return;
                }

                m_HandState.IsDetected = true;
                for (int i = 0; i < k_NumKeypoints; i++)
                {
                    float rawX = landmarks[3 * i + 0];
                    float rawY = landmarks[3 * i + 1];
                    float rawZ = landmarks[3 * i + 2];

                    var posImage = BlazeUtils.mul(M2, new float2(rawX, rawY));

                    // Normalize to [-0.5, 0.5] centered on image
                    float nx = (posImage.x - 0.5f * textureWidth) / textureHeight;
                    float ny = (posImage.y - 0.5f * textureHeight) / textureHeight;
                    float nz = rawZ / textureHeight;

                    // Apply One Euro jitter filter
                    float fx = m_Filters.Filter(i * 3 + 0, nx, deltaTime, FilterParams);
                    float fy = m_Filters.Filter(i * 3 + 1, ny, deltaTime, FilterParams);
                    float fz = m_Filters.Filter(i * 3 + 2, nz, deltaTime, FilterParams);

                    m_HandState.Joints[i].Position = new Vector3(fx, -fy, fz);
                    m_HandState.Joints[i].Confidence = outputScore[0];
                }

                m_HandState.PalmCenter = m_HandState.Joints[(int)HandJointId.Wrist].Position;
                m_HandState.IndexTip = m_HandState.Joints[(int)HandJointId.IndexTip].Position;
                m_HandState.ThumbTip = m_HandState.Joints[(int)HandJointId.ThumbTip].Position;

                m_HandState.PinchDistance = Vector3.Distance(m_HandState.IndexTip, m_HandState.ThumbTip);
                m_HandState.IsPinching = m_HandState.PinchDistance < 0.08f;
            }
            finally
            {
                m_IsRunning = false;
            }
        }

        public void Dispose()
        {
            m_DetectorWorker?.Dispose();
            m_LandmarkerWorker?.Dispose();
            m_DetectorInput?.Dispose();
            m_LandmarkerInput?.Dispose();
        }
    }
}
