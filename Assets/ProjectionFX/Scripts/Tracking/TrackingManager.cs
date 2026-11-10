using System;
using UnityEngine;
using ProjectionFX.Math;

namespace ProjectionFX.Tracking
{
    public class TrackingManager : MonoBehaviour, ITrackingSource
    {
        public static TrackingManager Instance { get; private set; }

        [Header("Mode & Camera")]
        public TrackingMode CurrentMode = TrackingMode.StaticObject;
        public int RequestedWebcamWidth = 1280;
        public int RequestedWebcamHeight = 720;
        public int RequestedFPS = 60;
        public Texture2D FallbackTestImage;

        [Header("Sentis ONNX Models")]
        public Unity.InferenceEngine.ModelAsset HandDetectorModel;
        public Unity.InferenceEngine.ModelAsset HandLandmarkerModel;
        public Unity.InferenceEngine.ModelAsset PoseDetectorModel;
        public Unity.InferenceEngine.ModelAsset PoseLandmarkerModel;

        [Header("Smoothing")]
        public OneEuroParams JitterFilterSettings = OneEuroParams.Default;

        [Header("Interaction Space Bounds (Meters)")]
        public Vector3 InteractionCenter = new Vector3(0, 1.2f, 1.5f);
        public Vector3 InteractionExtents = new Vector3(1.2f, 1.0f, 0.8f);

        WebCamTexture m_WebCamTexture;
        SentisHandTracker m_HandTracker;
        SentisPoseTracker m_PoseTracker;

        public bool IsReady => (m_WebCamTexture != null && m_WebCamTexture.didUpdateThisFrame) || FallbackTestImage != null;
        public Texture CameraTexture => m_WebCamTexture != null ? (Texture)m_WebCamTexture : FallbackTestImage;
        public RenderTexture SegmentationMask => m_PoseTracker?.SegmentationMask;
        public bool HasDepth => false; // Extensible for Intel RealSense / Azure Kinect

        public SentisHandTracker HandTracker => m_HandTracker;
        public SentisPoseTracker PoseTracker => m_PoseTracker;

        void Awake()
        {
            if (Instance == null) Instance = this;
            else { Destroy(gameObject); return; }
        }

        void Start()
        {
            InitializeCamera();

            m_HandTracker = new SentisHandTracker();
            m_HandTracker.FilterParams = JitterFilterSettings;
            m_HandTracker.Initialize(HandDetectorModel, HandLandmarkerModel);

            m_PoseTracker = new SentisPoseTracker();
            m_PoseTracker.FilterParams = JitterFilterSettings;
            m_PoseTracker.Initialize(PoseDetectorModel, PoseLandmarkerModel);
        }

        void InitializeCamera()
        {
            var devices = WebCamTexture.devices;
            if (devices.Length > 0)
            {
                m_WebCamTexture = new WebCamTexture(devices[0].name, RequestedWebcamWidth, RequestedWebcamHeight, RequestedFPS);
                m_WebCamTexture.Play();
                Debug.Log($"[TrackingManager] Started camera: {devices[0].name} ({m_WebCamTexture.width}x{m_WebCamTexture.height} @ {RequestedFPS}fps)");
            }
            else
            {
                Debug.LogWarning("[TrackingManager] No webcam detected. Using FallbackTestImage.");
            }
        }

        void Update()
        {
            var tex = CameraTexture;
            if (tex == null) return;

            float dt = Time.deltaTime;

            if (CurrentMode == TrackingMode.StaticObject)
            {
                // Hand tracking is primary for touching/interacting with static object
                if (m_HandTracker != null)
                {
                    _ = m_HandTracker.ProcessFrameAsync(tex, dt);
                }
            }
            else if (CurrentMode == TrackingMode.DynamicPerformer)
            {
                // Pose tracking and body segmentation are primary for projecting onto performer
                if (m_PoseTracker != null)
                {
                    _ = m_PoseTracker.ProcessFrameAsync(tex, dt);
                }
                // Optionally run hand tracker for performer gestures
                if (m_HandTracker != null)
                {
                    _ = m_HandTracker.ProcessFrameAsync(tex, dt);
                }
            }
        }

        public bool TryGetJoint(JointId jointId, out TrackedJoint joint)
        {
            joint = default;
            if (m_PoseTracker == null || m_PoseTracker.Joints == null) return false;
            int idx = (int)jointId;
            if (idx < 0 || idx >= m_PoseTracker.Joints.Length) return false;

            joint = m_PoseTracker.Joints[idx];
            if (joint.IsValid)
            {
                joint.WorldPosition = ProjectToInteractionSpace(new Vector2(joint.Position.x, joint.Position.y), joint.Position.z);
                return true;
            }
            return false;
        }

        public bool TryGetHand(bool isRightHand, out TrackedHand hand)
        {
            hand = default;
            if (m_HandTracker == null || !m_HandTracker.HandState.IsDetected) return false;

            hand = m_HandTracker.HandState;
            // Map key world positions into interaction space
            hand.PalmCenter = ProjectToInteractionSpace(new Vector2(hand.PalmCenter.x, hand.PalmCenter.y), hand.PalmCenter.z);
            hand.IndexTip = ProjectToInteractionSpace(new Vector2(hand.IndexTip.x, hand.IndexTip.y), hand.IndexTip.z);
            hand.ThumbTip = ProjectToInteractionSpace(new Vector2(hand.ThumbTip.x, hand.ThumbTip.y), hand.ThumbTip.z);
            return true;
        }

        public Vector3 ProjectToInteractionSpace(Vector2 normalizedCameraPoint, float depthMetric)
        {
            // Maps normalized camera coordinate space [-0.5, 0.5] into metric interaction box
            return new Vector3(
                InteractionCenter.x + normalizedCameraPoint.x * InteractionExtents.x,
                InteractionCenter.y + normalizedCameraPoint.y * InteractionExtents.y,
                InteractionCenter.z + depthMetric * InteractionExtents.z
            );
        }

        void OnDestroy()
        {
            if (m_WebCamTexture != null && m_WebCamTexture.isPlaying)
                m_WebCamTexture.Stop();

            m_HandTracker?.Dispose();
            m_PoseTracker?.Dispose();
        }
    }
}
