using System;
using UnityEngine;

namespace ProjectionFX.Display
{
    public class DualDisplayManager : MonoBehaviour
    {
        public static DualDisplayManager Instance { get; private set; }

        [Header("Cameras")]
        public Camera OperatorCamera;
        public Camera ProjectorCamera;

        [Header("Single Display Development Fallback")]
        public KeyCode ToggleViewHotkey = KeyCode.Tab;
        public bool IsShowingProjectorOnMainDisplay = false;

        void Awake()
        {
            if (Instance == null) Instance = this;
            else { Destroy(gameObject); return; }

            ConfigureDisplays();
        }

        void ConfigureDisplays()
        {
            Debug.Log($"[DualDisplayManager] Found {UnityEngine.Display.displays.Length} connected display(s).");

            if (UnityEngine.Display.displays.Length > 1)
            {
                // Activate secondary display for projector
                var projDisplay = UnityEngine.Display.displays[1];
                projDisplay.Activate();
                Debug.Log($"[DualDisplayManager] Activated Display 2: {projDisplay.renderingWidth}x{projDisplay.renderingHeight}");

                if (OperatorCamera != null) OperatorCamera.targetDisplay = 0;
                if (ProjectorCamera != null) ProjectorCamera.targetDisplay = 1;
            }
            else
            {
                Debug.Log("[DualDisplayManager] Single monitor detected. Use TAB to switch between Operator Console and Projector View.");
                SetSingleDisplayMode(false);
            }
        }

        void Update()
        {
            if (Input.GetKeyDown(ToggleViewHotkey))
            {
                if (UnityEngine.Display.displays.Length <= 1)
                {
                    IsShowingProjectorOnMainDisplay = !IsShowingProjectorOnMainDisplay;
                    SetSingleDisplayMode(IsShowingProjectorOnMainDisplay);
                }
            }

            if (Input.GetKeyDown(KeyCode.F11))
            {
                Screen.fullScreen = !Screen.fullScreen;
            }
        }

        public void SetSingleDisplayMode(bool showProjector)
        {
            if (OperatorCamera != null)
            {
                OperatorCamera.enabled = !showProjector;
                OperatorCamera.targetDisplay = 0;
            }

            if (ProjectorCamera != null)
            {
                ProjectorCamera.enabled = showProjector;
                ProjectorCamera.targetDisplay = 0;
            }
        }
    }
}
