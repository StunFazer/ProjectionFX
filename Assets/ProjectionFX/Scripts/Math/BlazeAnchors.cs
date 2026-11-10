// SSD anchor generation for MediaPipe BlazePalm / BlazePose detectors
// (equivalent to MediaPipe's SsdAnchorsCalculator with fixed_anchor_size=true, aspect_ratios=[1.0],
//  interpolated_scale_aspect_ratio=1.0 -> 2 anchors per layer, layers with equal stride merged).
using System.Collections.Generic;

namespace ProjectionFX.Math
{
    public static class BlazeAnchors
    {
        public static readonly int[] HandStrides = { 8, 16, 16, 16 };     // 192x192 input -> 2016 anchors
        public static readonly int[] PoseStrides = { 8, 16, 32, 32, 32 }; // 224x224 input -> 2254 anchors

        /// <summary>Returns anchor centres in normalised [0,1] tensor coordinates, interleaved (x0,y0,x1,y1,...).</summary>
        public static float[] Generate(int inputSize, int[] strides)
        {
            var result = new List<float>();
            int layer = 0;
            while (layer < strides.Length)
            {
                int stride = strides[layer];
                int sameStrideLayers = 0;
                while (layer < strides.Length && strides[layer] == stride) { sameStrideLayers++; layer++; }

                int anchorsPerCell = 2 * sameStrideLayers;
                int fm = (inputSize + stride - 1) / stride;
                for (int y = 0; y < fm; y++)
                    for (int x = 0; x < fm; x++)
                    {
                        float cx = (x + 0.5f) / fm, cy = (y + 0.5f) / fm;
                        for (int a = 0; a < anchorsPerCell; a++) { result.Add(cx); result.Add(cy); }
                    }
            }
            return result.ToArray();
        }
    }
}
