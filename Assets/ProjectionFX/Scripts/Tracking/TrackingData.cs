using System;
using UnityEngine;

namespace ProjectionFX.Tracking
{
    public enum TrackingMode
    {
        StaticObject,     // Project onto static object; track spectator's hands/face for interaction
        DynamicPerformer  // Project onto moving human/performer; track body silhouette & skeleton
    }

    public enum JointId
    {
        Nose = 0,
        LeftEyeInner = 1, LeftEye = 2, LeftEyeOuter = 3,
        RightEyeInner = 4, RightEye = 5, RightEyeOuter = 6,
        LeftEar = 7, RightEar = 8,
        MouthLeft = 9, MouthRight = 10,
        LeftShoulder = 11, RightShoulder = 12,
        LeftElbow = 13, RightElbow = 14,
        LeftWrist = 15, RightWrist = 16,
        LeftPinky = 17, RightPinky = 18,
        LeftIndex = 19, RightIndex = 20,
        LeftThumb = 21, RightThumb = 22,
        LeftHip = 23, RightHip = 24,
        LeftKnee = 25, RightKnee = 26,
        LeftAnkle = 27, RightAnkle = 28,
        LeftHeel = 29, RightHeel = 30,
        LeftFootIndex = 31, RightFootIndex = 32,
        Count = 33
    }

    public enum HandJointId
    {
        Wrist = 0,
        ThumbCMC = 1, ThumbMCP = 2, ThumbIP = 3, ThumbTip = 4,
        IndexMCP = 5, IndexPIP = 6, IndexDIP = 7, IndexTip = 8,
        MiddleMCP = 9, MiddlePIP = 10, MiddleDIP = 11, MiddleTip = 12,
        RingMCP = 13, RingPIP = 14, RingDIP = 15, RingTip = 16,
        PinkyMCP = 17, PinkyPIP = 18, PinkyDIP = 19, PinkyTip = 20,
        Count = 21
    }

    public struct TrackedJoint
    {
        public Vector3 Position; // Normalised camera coordinates [-0.5, 0.5] with aspect ratio corrected
        public Vector3 WorldPosition; // Mapped into 3D interaction space
        public float Confidence;
        public bool IsValid => Confidence > 0.4f;
    }

    public struct TrackedHand
    {
        public bool IsDetected;
        public TrackedJoint[] Joints; // 21 keypoints
        public Vector3 PalmCenter;
        public Vector3 IndexTip;
        public Vector3 ThumbTip;
        public float PinchDistance;
        public bool IsPinching;
    }

    public interface ITrackingSource
    {
        bool IsReady { get; }
        Texture CameraTexture { get; }
        RenderTexture SegmentationMask { get; }
        bool HasDepth { get; }

        bool TryGetJoint(JointId jointId, out TrackedJoint joint);
        bool TryGetHand(bool isRightHand, out TrackedHand hand);
        Vector3 ProjectToInteractionSpace(Vector2 normalizedCameraPoint, float depthMeters);
    }
}
