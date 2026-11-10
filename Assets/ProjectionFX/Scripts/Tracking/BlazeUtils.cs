using System;
using Unity.Mathematics;
using Unity.InferenceEngine;
using UnityEngine;

namespace ProjectionFX.Tracking
{
    public static class BlazeUtils
    {
        public static float2x3 mul(float2x3 a, float2x3 b)
        {
            return new float2x3(
                a[0][0] * b[0][0] + a[1][0] * b[0][1],
                a[0][0] * b[1][0] + a[1][0] * b[1][1],
                a[0][0] * b[2][0] + a[1][0] * b[2][1] + a[2][0],
                a[0][1] * b[0][0] + a[1][1] * b[0][1],
                a[0][1] * b[1][0] + a[1][1] * b[1][1],
                a[0][1] * b[2][0] + a[1][1] * b[2][1] + a[2][1]
            );
        }

        public static float2 mul(float2x3 a, float2 b)
        {
            return new float2(
                a[0][0] * b.x + a[1][0] * b.y + a[2][0],
                a[0][1] * b.x + a[1][1] * b.y + a[2][1]
            );
        }

        public static float2x3 RotationMatrix(float theta)
        {
            var sinTheta = math.sin(theta);
            var cosTheta = math.cos(theta);
            return new float2x3(
                cosTheta, -sinTheta, 0,
                sinTheta, cosTheta, 0
            );
        }

        public static float2x3 TranslationMatrix(float2 delta)
        {
            return new float2x3(
                1, 0, delta.x,
                0, 1, delta.y
            );
        }

        public static float2x3 ScaleMatrix(float2 scale)
        {
            return new float2x3(
                scale.x, 0, 0,
                0, scale.y, 0
            );
        }

        static FunctionalTensor ScoreFiltering(FunctionalTensor rawScores, float scoreThreshold)
        {
            return Functional.Sigmoid(Functional.Clamp(rawScores, -scoreThreshold, scoreThreshold));
        }

        public static (FunctionalTensor, FunctionalTensor, FunctionalTensor) ArgMaxFiltering(FunctionalTensor rawBoxes, FunctionalTensor rawScores)
        {
            var detectionScores = ScoreFiltering(rawScores, 100f);
            var bestScoreIndex = Functional.ArgMax(rawScores, 1).Squeeze();

            var selectedBoxes = Functional.IndexSelect(rawBoxes, 1, bestScoreIndex).Unsqueeze(0);
            var selectedScores = Functional.IndexSelect(detectionScores, 1, bestScoreIndex).Unsqueeze(0);

            return (bestScoreIndex, selectedScores, selectedBoxes);
        }

        static ComputeShader s_ImageTransformShader;
        static int s_ImageSampleKernel = -1;
        static int s_Optr = Shader.PropertyToID("Optr");
        static int s_X_tex2D = Shader.PropertyToID("X_tex2D");
        static int s_O_height = Shader.PropertyToID("O_height");
        static int s_O_width = Shader.PropertyToID("O_width");
        static int s_O_channels = Shader.PropertyToID("O_channels");
        static int s_X_height = Shader.PropertyToID("X_height");
        static int s_X_width = Shader.PropertyToID("X_width");
        static int s_affineMatrix = Shader.PropertyToID("affineMatrix");

        static void EnsureShader()
        {
            if (s_ImageTransformShader == null)
            {
                s_ImageTransformShader = Resources.Load<ComputeShader>("ComputeShaders/ImageTransform");
                if (s_ImageTransformShader != null)
                    s_ImageSampleKernel = s_ImageTransformShader.FindKernel("ImageSample");
            }
        }

        public static void SampleImageAffine(Texture srcTexture, Tensor<float> dstTensor, float2x3 M)
        {
            EnsureShader();
            if (s_ImageTransformShader == null || srcTexture == null) return;

            var tensorData = ComputeTensorData.Pin(dstTensor, false);

            s_ImageTransformShader.SetTexture(s_ImageSampleKernel, s_X_tex2D, srcTexture);
            s_ImageTransformShader.SetBuffer(s_ImageSampleKernel, s_Optr, tensorData.buffer);

            s_ImageTransformShader.SetInt(s_O_height, dstTensor.shape[1]);
            s_ImageTransformShader.SetInt(s_O_width, dstTensor.shape[2]);
            s_ImageTransformShader.SetInt(s_O_channels, dstTensor.shape[3]);
            s_ImageTransformShader.SetInt(s_X_height, srcTexture.height);
            s_ImageTransformShader.SetInt(s_X_width, srcTexture.width);

            Matrix4x4 mat = new Matrix4x4(
                new Vector4(M[0][0], M[0][1], 0, 0),
                new Vector4(M[1][0], M[1][1], 0, 0),
                new Vector4(M[2][0], M[2][1], 1, 0),
                Vector4.zero
            );
            s_ImageTransformShader.SetMatrix(s_affineMatrix, mat);

            int gx = (dstTensor.shape[2] + 7) / 8;
            int gy = (dstTensor.shape[1] + 7) / 8;
            s_ImageTransformShader.Dispatch(s_ImageSampleKernel, gx, gy, 1);
        }
    }
}
