using System;
using Unity.Mathematics;
using Unity.InferenceEngine;
using UnityEngine;
using ProjectionFX.Math;

namespace ProjectionFX.Tracking
{
    public sealed class SentisPoseTracker : IDisposable
    {
        public ModelAsset PoseDetectorAsset;
        public ModelAsset PoseLandmarkerAsset;
        public float ScoreThreshold = 0.7f;

        const int k_NumAnchors = 2254;
        const int k_NumKeypoints = 33;
        const int detectorInputSize = 224;
        const int landmarkerInputSize = 256;

        float[] m_Anchors;
        Worker m_DetectorWorker;
        Worker m_LandmarkerWorker;
        Tensor<float> m_DetectorInput;
        Tensor<float> m_LandmarkerInput;

        readonly OneEuroFilterBank m_Filters = new OneEuroFilterBank(k_NumKeypoints * 3);
        public OneEuroParams FilterParams = OneEuroParams.Default;

        TrackedJoint[] m_Joints;
        public TrackedJoint[] Joints => m_Joints;

        RenderTexture m_SegmentationMask;
        public RenderTexture SegmentationMask => m_SegmentationMask;

        ComputeShader m_MaskShader;
        int m_MaskKernel = -1;

        bool m_IsRunning;

        public void Initialize(ModelAsset detectorModel, ModelAsset landmarkerModel)
        {
            PoseDetectorAsset = detectorModel;
            PoseLandmarkerAsset = landmarkerModel;

            m_Anchors = BlazeAnchors.Generate(detectorInputSize, BlazeAnchors.PoseStrides);

            if (PoseDetectorAsset != null)
            {
                var detectorModelRuntime = ModelLoader.Load(PoseDetectorAsset);
                var graph = new FunctionalGraph();
                var input = graph.AddInput(detectorModelRuntime, 0);
                var outputs = Functional.Forward(detectorModelRuntime, input);
                var boxes = outputs[0];
                var scores = outputs[1];
                var filtered = BlazeUtils.ArgMaxFiltering(boxes, scores);
                detectorModelRuntime = graph.Compile(filtered.Item1, filtered.Item2, filtered.Item3);
                m_DetectorWorker = new Worker(detectorModelRuntime, BackendType.GPUCompute);
            }

            if (PoseLandmarkerAsset != null)
            {
                var landmarkerModelRuntime = ModelLoader.Load(PoseLandmarkerAsset);
                m_LandmarkerWorker = new Worker(landmarkerModelRuntime, BackendType.GPUCompute);
            }

            m_DetectorInput = new Tensor<float>(new TensorShape(1, detectorInputSize, detectorInputSize, 3));
            m_LandmarkerInput = new Tensor<float>(new TensorShape(1, landmarkerInputSize, landmarkerInputSize, 3));

            m_Joints = new TrackedJoint[k_NumKeypoints];

            m_SegmentationMask = new RenderTexture(landmarkerInputSize, landmarkerInputSize, 0, RenderTextureFormat.ARGB32)
            {
                enableRandomWrite = true,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                name = "PoseSegmentationMask"
            };
            m_SegmentationMask.Create();

            m_MaskShader = Resources.Load<ComputeShader>("ComputeShaders/SegmentationMaskBlit");
            if (m_MaskShader != null)
                m_MaskKernel = m_MaskShader.FindKernel("MaskToTexture");
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
                    for (int i = 0; i < k_NumKeypoints; i++)
                        m_Joints[i].Confidence = 0;
                    return;
                }

                int idx = outputIdx[0];
                float ax = m_Anchors[idx * 2 + 0];
                float ay = m_Anchors[idx * 2 + 1];
                var anchorPos = detectorInputSize * new float2(ax, ay);

                var kp1 = BlazeUtils.mul(M, anchorPos + new float2(outputBox[0, 0, 4], outputBox[0, 0, 5]));
                var kp2 = BlazeUtils.mul(M, anchorPos + new float2(outputBox[0, 0, 6], outputBox[0, 0, 7]));
                var delta = kp2 - kp1;
                float radius = 1.25f * math.length(delta);
                float theta = math.atan2(delta.y, delta.x);

                var origin2 = new float2(0.5f * landmarkerInputSize, 0.5f * landmarkerInputSize);
                float scale2 = radius / (0.5f * landmarkerInputSize);
                var M2 = BlazeUtils.mul(
                    BlazeUtils.mul(
                        BlazeUtils.mul(BlazeUtils.TranslationMatrix(kp1), BlazeUtils.ScaleMatrix(new float2(scale2, -scale2))),
                        BlazeUtils.RotationMatrix(0.5f * Mathf.PI - theta)
                    ),
                    BlazeUtils.TranslationMatrix(-origin2)
                );

                BlazeUtils.SampleImageAffine(texture, m_LandmarkerInput, M2);
                m_LandmarkerWorker.Schedule(m_LandmarkerInput);

                // Landmark output is Identity (1, 195)
                var landmarksAwaitable = (m_LandmarkerWorker.PeekOutput("Identity") as Tensor<float>).ReadbackAndCloneAsync();
                using var landmarks = await landmarksAwaitable;

                // Segmentation mask is Identity_2 (1, 256, 256, 1)
                var maskTensor = m_LandmarkerWorker.PeekOutput("Identity_2") as Tensor<float>;
                if (maskTensor != null && m_MaskShader != null && m_MaskKernel >= 0)
                {
                    var pinnedData = ComputeTensorData.Pin(maskTensor, false);
                    m_MaskShader.SetBuffer(m_MaskKernel, "MaskTensor", pinnedData.buffer);
                    m_MaskShader.SetTexture(m_MaskKernel, "OutputMask", m_SegmentationMask);
                    m_MaskShader.SetInt("MaskWidth", landmarkerInputSize);
                    m_MaskShader.SetInt("MaskHeight", landmarkerInputSize);
                    m_MaskShader.SetFloat("Threshold", 0.5f);
                    m_MaskShader.SetFloat("Smoothness", 0.08f);
                    m_MaskShader.Dispatch(m_MaskKernel, landmarkerInputSize / 8, landmarkerInputSize / 8, 1);
                }

                if (landmarks == null) return;

                for (int i = 0; i < k_NumKeypoints; i++)
                {
                    float rawX = landmarks[5 * i + 0];
                    float rawY = landmarks[5 * i + 1];
                    float rawZ = landmarks[5 * i + 2];
                    float visibility = landmarks[5 * i + 3];
                    float presence = landmarks[5 * i + 4];

                    var posImage = BlazeUtils.mul(M2, new float2(rawX, rawY));
                    float nx = (posImage.x - 0.5f * textureWidth) / textureHeight;
                    float ny = (posImage.y - 0.5f * textureHeight) / textureHeight;
                    float nz = rawZ / textureHeight;

                    float fx = m_Filters.Filter(i * 3 + 0, nx, deltaTime, FilterParams);
                    float fy = m_Filters.Filter(i * 3 + 1, ny, deltaTime, FilterParams);
                    float fz = m_Filters.Filter(i * 3 + 2, nz, deltaTime, FilterParams);

                    m_Joints[i].Position = new Vector3(fx, -fy, fz);
                    m_Joints[i].Confidence = (visibility > 0.5f && presence > 0.5f) ? presence : 0;
                }
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
            if (m_SegmentationMask != null)
            {
                m_SegmentationMask.Release();
                UnityEngine.Object.Destroy(m_SegmentationMask);
            }
        }
    }
}
