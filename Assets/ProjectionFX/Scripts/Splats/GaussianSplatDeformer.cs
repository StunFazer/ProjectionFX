using System;
using System.Reflection;
using UnityEngine;
using GaussianSplatting.Runtime;
using ProjectionFX.Tracking;

namespace ProjectionFX.Splats
{
    [RequireComponent(typeof(GaussianSplatRenderer))]
    public class GaussianSplatDeformer : MonoBehaviour
    {
        [Header("Compute Shader")]
        public ComputeShader DeformComputeShader;

        [Header("Deformation Dynamics")]
        [Range(0.05f, 1.5f)] public float DisplaceRadius = 0.35f;
        [Range(0.0f, 10.0f)] public float DisplaceStrength = 3.5f;
        [Range(0.0f, 10.0f)] public float TurbulenceStrength = 2.0f;
        [Range(0.0f, 1.0f)] public float DissolveRadius = 0.20f;
        [Range(0.5f, 20.0f)] public float RecoverySpeed = 6.0f;

        [Header("Tracking Reference")]
        public TrackingManager Tracking;

        GaussianSplatRenderer m_Renderer;
        GraphicsBuffer m_BasePosBuffer;
        GraphicsBuffer m_GpuPosBuffer;
        GraphicsBuffer m_GpuOtherBuffer;

        int m_KernelDeform = -1;
        int m_KernelReset = -1;
        int m_LastSplatCount = 0;

        FieldInfo m_GpuPosField;
        FieldInfo m_GpuOtherField;

        Vector4[] m_InteractionPoints = new Vector4[8];

        void Awake()
        {
            m_Renderer = GetComponent<GaussianSplatRenderer>();

            // Reflection to access internal GPU buffers of GaussianSplatRenderer
            var type = typeof(GaussianSplatRenderer);
            m_GpuPosField = type.GetField("m_GpuPosData", BindingFlags.NonPublic | BindingFlags.Instance);
            m_GpuOtherField = type.GetField("m_GpuOtherData", BindingFlags.NonPublic | BindingFlags.Instance);

            if (DeformComputeShader == null)
                DeformComputeShader = Resources.Load<ComputeShader>("ComputeShaders/SplatDeformCompute");

            if (DeformComputeShader != null)
            {
                m_KernelDeform = DeformComputeShader.FindKernel("CSDeformSplats");
                m_KernelReset = DeformComputeShader.FindKernel("CSResetSplats");
            }
        }

        void Start()
        {
            if (Tracking == null)
                Tracking = TrackingManager.Instance;
        }

        void LateUpdate()
        {
            if (m_Renderer == null || !m_Renderer.HasValidRenderSetup || DeformComputeShader == null)
                return;

            EnsureBuffers();
            if (m_BasePosBuffer == null || m_GpuPosBuffer == null)
                return;

            int activeCount = GatherInteractionPoints();

            DeformComputeShader.SetBuffer(m_KernelDeform, "_BasePosBuffer", m_BasePosBuffer);
            DeformComputeShader.SetBuffer(m_KernelDeform, "_DeformedPosBuffer", m_GpuPosBuffer);
            if (m_GpuOtherBuffer != null)
                DeformComputeShader.SetBuffer(m_KernelDeform, "_GeometryBuffer", m_GpuOtherBuffer);

            DeformComputeShader.SetInt("_SplatCount", m_Renderer.splatCount);
            DeformComputeShader.SetFloat("_DeltaTime", Time.deltaTime);
            DeformComputeShader.SetFloat("_Time", Time.time);

            DeformComputeShader.SetVectorArray("_InteractionPoints", m_InteractionPoints);
            DeformComputeShader.SetInt("_InteractionPointCount", activeCount);

            DeformComputeShader.SetFloat("_DisplaceRadius", DisplaceRadius);
            DeformComputeShader.SetFloat("_DisplaceStrength", DisplaceStrength);
            DeformComputeShader.SetFloat("_TurbulenceStrength", TurbulenceStrength);
            DeformComputeShader.SetFloat("_DissolveRadius", DissolveRadius);
            DeformComputeShader.SetFloat("_RecoverySpeed", RecoverySpeed);

            int threadGroups = (m_Renderer.splatCount + 255) / 256;
            DeformComputeShader.Dispatch(m_KernelDeform, threadGroups, 1, 1);
        }

        int GatherInteractionPoints()
        {
            int count = 0;
            if (Tracking == null) return 0;

            // Check tracked hand
            if (Tracking.TryGetHand(true, out var rightHand))
            {
                // Index fingertip in local splat space
                Vector3 localIndex = transform.InverseTransformPoint(rightHand.IndexTip);
                float strength = rightHand.IsPinching ? 1.8f : 1.0f;
                m_InteractionPoints[count++] = new Vector4(localIndex.x, localIndex.y, localIndex.z, strength);

                // Palm center
                Vector3 localPalm = transform.InverseTransformPoint(rightHand.PalmCenter);
                m_InteractionPoints[count++] = new Vector4(localPalm.x, localPalm.y, localPalm.z, 1.2f);
            }

            // Check tracked body wrists if in Dynamic mode
            if (Tracking.CurrentMode == TrackingMode.DynamicPerformer)
            {
                if (Tracking.TryGetJoint(JointId.RightWrist, out var rw))
                {
                    Vector3 l = transform.InverseTransformPoint(rw.WorldPosition);
                    m_InteractionPoints[count++] = new Vector4(l.x, l.y, l.z, 1.0f);
                }
                if (Tracking.TryGetJoint(JointId.LeftWrist, out var lw))
                {
                    Vector3 l = transform.InverseTransformPoint(lw.WorldPosition);
                    m_InteractionPoints[count++] = new Vector4(l.x, l.y, l.z, 1.0f);
                }
            }

            return count;
        }

        void EnsureBuffers()
        {
            m_GpuPosBuffer = m_GpuPosField?.GetValue(m_Renderer) as GraphicsBuffer;
            m_GpuOtherBuffer = m_GpuOtherField?.GetValue(m_Renderer) as GraphicsBuffer;

            int count = m_Renderer.splatCount;
            if (count > 0 && (m_BasePosBuffer == null || m_LastSplatCount != count))
            {
                m_BasePosBuffer?.Dispose();
                m_BasePosBuffer = new GraphicsBuffer(GraphicsBuffer.Target.Raw, count * 3, 4) { name = "BaseSplatPos" };

                // Copy original positions into base pos buffer
                GraphicsBuffer.CopyCount(m_GpuPosBuffer, m_BasePosBuffer, 0); // or direct copy
                CopyBuffer(m_GpuPosBuffer, m_BasePosBuffer, count * 12);

                m_LastSplatCount = count;
            }
        }

        static void CopyBuffer(GraphicsBuffer src, GraphicsBuffer dst, int byteLength)
        {
            var cb = new UnityEngine.Rendering.CommandBuffer();
            cb.CopyBuffer(src, dst);
            Graphics.ExecuteCommandBuffer(cb);
            cb.Dispose();
        }

        public void ResetToOrigin()
        {
            if (m_BasePosBuffer != null && m_GpuPosBuffer != null && m_KernelReset >= 0)
            {
                DeformComputeShader.SetBuffer(m_KernelReset, "_BasePosBuffer", m_BasePosBuffer);
                DeformComputeShader.SetBuffer(m_KernelReset, "_DeformedPosBuffer", m_GpuPosBuffer);
                DeformComputeShader.SetInt("_SplatCount", m_Renderer.splatCount);
                int groups = (m_Renderer.splatCount + 255) / 256;
                DeformComputeShader.Dispatch(m_KernelReset, groups, 1, 1);
            }
        }

        void OnDisable()
        {
            ResetToOrigin();
            m_BasePosBuffer?.Dispose();
            m_BasePosBuffer = null;
        }
    }
}
