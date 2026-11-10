using System;
using UnityEngine;

namespace ProjectionFX.Effects
{
    public class ReferenceModelAlignment : MonoBehaviour
    {
        [Header("Alignment Visuals")]
        public Material ContourAlignmentMaterial;
        public bool ShowContours = false;

        [Header("Colliders")]
        public MeshCollider ModelCollider;

        MeshRenderer[] m_Renderers;
        Material[] m_OriginalMaterials;

        void Awake()
        {
            m_Renderers = GetComponentsInChildren<MeshRenderer>();
            if (m_Renderers.Length > 0)
            {
                m_OriginalMaterials = new Material[m_Renderers.Length];
                for (int i = 0; i < m_Renderers.Length; i++)
                {
                    m_OriginalMaterials[i] = m_Renderers[i].sharedMaterial;
                }
            }

            if (ModelCollider == null)
            {
                ModelCollider = GetComponentInChildren<MeshCollider>();
                if (ModelCollider == null)
                {
                    var mf = GetComponentInChildren<MeshFilter>();
                    if (mf != null && mf.sharedMesh != null)
                    {
                        var mc = mf.gameObject.AddComponent<MeshCollider>();
                        mc.sharedMesh = mf.sharedMesh;
                        ModelCollider = mc;
                    }
                }
            }
        }

        public void SetContourVisibility(bool visible)
        {
            ShowContours = visible;
            if (ContourAlignmentMaterial == null || m_Renderers == null) return;

            for (int i = 0; i < m_Renderers.Length; i++)
            {
                m_Renderers[i].material = visible ? ContourAlignmentMaterial : m_OriginalMaterials[i];
            }
        }

        public bool RaycastToSurface(Ray ray, out RaycastHit hit, float maxDistance = 10f)
        {
            if (ModelCollider != null)
            {
                return ModelCollider.Raycast(ray, out hit, maxDistance);
            }
            hit = default;
            return false;
        }

        public Vector3 GetClosestSurfacePoint(Vector3 worldPoint)
        {
            if (ModelCollider != null)
            {
                return ModelCollider.ClosestPoint(worldPoint);
            }
            return worldPoint;
        }
    }
}
