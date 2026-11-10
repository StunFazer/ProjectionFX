using System;
using UnityEngine;
using ProjectionFX.Tracking;

namespace ProjectionFX.Effects
{
    public class DynamicPerformerRig : MonoBehaviour
    {
        [Header("Tracking Reference")]
        public TrackingManager Tracking;

        [Header("Visual Proxy Bones")]
        public GameObject JointPrefab;
        public Material BoneLineMaterial;
        public float JointScale = 0.05f;

        [Header("Masking Material")]
        public Material PerformerMaskMaterial;

        Transform[] m_JointTransforms;
        LineRenderer[] m_BoneLines;

        // Common skeleton connectivity pairs for 33 BlazePose joints
        static readonly (JointId, JointId)[] BonePairs = new (JointId, JointId)[]
        {
            // Upper body
            (JointId.LeftShoulder, JointId.RightShoulder),
            (JointId.LeftShoulder, JointId.LeftElbow),
            (JointId.LeftElbow, JointId.LeftWrist),
            (JointId.RightShoulder, JointId.RightElbow),
            (JointId.RightElbow, JointId.RightWrist),
            // Torso
            (JointId.LeftShoulder, JointId.LeftHip),
            (JointId.RightShoulder, JointId.RightHip),
            (JointId.LeftHip, JointId.RightHip),
            // Lower body
            (JointId.LeftHip, JointId.LeftKnee),
            (JointId.LeftKnee, JointId.LeftAnkle),
            (JointId.RightHip, JointId.RightKnee),
            (JointId.RightKnee, JointId.RightAnkle)
        };

        void Start()
        {
            if (Tracking == null) Tracking = TrackingManager.Instance;
            BuildRigHierarchy();
        }

        void BuildRigHierarchy()
        {
            int jointCount = (int)JointId.Count;
            m_JointTransforms = new Transform[jointCount];

            for (int i = 0; i < jointCount; i++)
            {
                var go = JointPrefab != null ? Instantiate(JointPrefab, transform) : GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.transform.SetParent(transform, false);
                go.transform.localScale = Vector3.one * JointScale;
                go.name = $"Joint_{(JointId)i}";

                // Remove collider if using default primitive
                var col = go.GetComponent<Collider>();
                if (col != null && JointPrefab == null) Destroy(col);

                m_JointTransforms[i] = go.transform;
            }

            m_BoneLines = new LineRenderer[BonePairs.Length];
            for (int i = 0; i < BonePairs.Length; i++)
            {
                var lineGO = new GameObject($"Bone_{BonePairs[i].Item1}_{BonePairs[i].Item2}");
                lineGO.transform.SetParent(transform, false);
                var lr = lineGO.AddComponent<LineRenderer>();
                lr.positionCount = 2;
                lr.startWidth = JointScale * 0.4f;
                lr.endWidth = JointScale * 0.4f;
                if (BoneLineMaterial != null) lr.material = BoneLineMaterial;
                m_BoneLines[i] = lr;
            }
        }

        void Update()
        {
            if (Tracking == null) return;

            bool isDynamic = Tracking.CurrentMode == TrackingMode.DynamicPerformer;
            gameObject.SetActive(isDynamic);
            if (!isDynamic) return;

            // Update joint positions
            for (int i = 0; i < (int)JointId.Count; i++)
            {
                if (Tracking.TryGetJoint((JointId)i, out var joint))
                {
                    m_JointTransforms[i].position = joint.WorldPosition;
                    m_JointTransforms[i].gameObject.SetActive(true);
                }
                else
                {
                    m_JointTransforms[i].gameObject.SetActive(false);
                }
            }

            // Update bone links
            for (int i = 0; i < BonePairs.Length; i++)
            {
                int a = (int)BonePairs[i].Item1;
                int b = (int)BonePairs[i].Item2;
                if (m_JointTransforms[a].gameObject.activeSelf && m_JointTransforms[b].gameObject.activeSelf)
                {
                    m_BoneLines[i].enabled = true;
                    m_BoneLines[i].SetPosition(0, m_JointTransforms[a].position);
                    m_BoneLines[i].SetPosition(1, m_JointTransforms[b].position);
                }
                else
                {
                    m_BoneLines[i].enabled = false;
                }
            }

            // Update segmentation mask texture on the light-mask material
            if (PerformerMaskMaterial != null && Tracking.SegmentationMask != null)
            {
                PerformerMaskMaterial.SetTexture("_MaskTex", Tracking.SegmentationMask);
            }
        }
    }
}
