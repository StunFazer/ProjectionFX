// One Euro filter (Casiez et al. 2012): low-latency jitter removal for tracked landmarks.
using System;

namespace ProjectionFX.Math
{
    [Serializable]
    public struct OneEuroParams
    {
        public float MinCutoff; // Hz, lower = smoother when still
        public float Beta;      // speed coefficient, higher = less lag when moving
        public float DCutoff;   // Hz, derivative cutoff

        public static OneEuroParams Default => new OneEuroParams { MinCutoff = 1.5f, Beta = 0.02f, DCutoff = 1.0f };
    }

    public sealed class OneEuroFilter
    {
        float m_X, m_Dx;
        bool m_Init;

        public float Filter(float x, float dt, in OneEuroParams p)
        {
            if (!m_Init || dt <= 0) { m_X = x; m_Dx = 0; m_Init = true; return x; }
            float dx = (x - m_X) / dt;
            m_Dx += Alpha(dt, p.DCutoff) * (dx - m_Dx);
            float cutoff = p.MinCutoff + p.Beta * System.Math.Abs(m_Dx);
            m_X += Alpha(dt, cutoff) * (x - m_X);
            return m_X;
        }

        public void Reset() => m_Init = false;

        static float Alpha(float dt, float cutoff)
        {
            float tau = 1f / (2f * (float)System.Math.PI * System.Math.Max(cutoff, 1e-4f));
            return 1f / (1f + tau / dt);
        }
    }

    /// <summary>Filters N-dimensional points (e.g. 21 or 33 landmarks x 3 components).</summary>
    public sealed class OneEuroFilterBank
    {
        readonly OneEuroFilter[] m_Filters;
        public OneEuroFilterBank(int count)
        {
            m_Filters = new OneEuroFilter[count];
            for (int i = 0; i < count; i++) m_Filters[i] = new OneEuroFilter();
        }

        public float Filter(int index, float x, float dt, in OneEuroParams p) => m_Filters[index].Filter(x, dt, p);
        public void Reset() { foreach (var f in m_Filters) f.Reset(); }
    }
}
