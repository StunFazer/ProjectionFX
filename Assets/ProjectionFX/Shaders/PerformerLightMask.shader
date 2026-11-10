Shader "ProjectionFX/PerformerLightMask"
{
    Properties
    {
        _MainTex ("Camera Render", 2D) = "black" {}
        _MaskTex ("Segmentation Mask", 2D) = "white" {}
        _MaskThreshold ("Mask Threshold", Range(0.0, 1.0)) = 0.5
        _EdgeFeather ("Edge Feather", Range(0.001, 0.2)) = 0.05
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

            Texture2D _MaskTex;
            SamplerState sampler_MaskTex;

            float _MaskThreshold;
            float _EdgeFeather;

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 sceneColor = _MainTex.Sample(sampler_MainTex, input.uv);
                half maskVal = _MaskTex.Sample(sampler_MaskTex, input.uv).a;

                // Soft alpha cut for smooth edge blending on performer's silhouette
                float alpha = smoothstep(_MaskThreshold - _EdgeFeather, _MaskThreshold + _EdgeFeather, maskVal);

                // Zero out projected light outside the tracked performer
                return sceneColor * alpha;
            }
            ENDHLSL
        }
    }
}
