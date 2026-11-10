Shader "ProjectionFX/CornerPinWarp"
{
    Properties
    {
        _MainTex ("Source Texture", 2D) = "black" {}
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" }
        ZTest Always ZWrite Off Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Texture2D _MainTex;
            SamplerState sampler_MainTex;

            // 3x3 Inverse Homography matrix mapping warped screen UV -> unwarped source texture UV
            float3x3 _InvHomography;
            float4 _BorderColor;

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 screenUV = float3(input.uv, 1.0);
                float3 sourceUV = mul(_InvHomography, screenUV);

                float w = sourceUV.z;
                if (abs(w) < 1e-6) return half4(0, 0, 0, 1);

                float2 uv = sourceUV.xy / w;

                // Out of bounds check
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
                {
                    return _BorderColor; // Typically pure black (0, 0, 0, 1) to prevent projector bleed
                }

                half4 col = _MainTex.Sample(sampler_MainTex, uv);
                return col;
            }
            ENDHLSL
        }
    }
}
