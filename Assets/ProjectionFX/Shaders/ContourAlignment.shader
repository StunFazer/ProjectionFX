Shader "ProjectionFX/ContourAlignment"
{
    Properties
    {
        _EdgeColor ("Edge Color", Color) = (0.0, 1.0, 1.0, 1.0)
        _FillColor ("Fill Color", Color) = (0.0, 0.0, 0.0, 0.0)
        _EdgeWidth ("Edge Width", Range(0.1, 5.0)) = 1.5
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Back

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldNormal : TEXCOORD0;
                float3 viewDir : TEXCOORD1;
            };

            float4 _EdgeColor;
            float4 _FillColor;
            float _EdgeWidth;

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.worldNormal = TransformObjectToWorldNormal(input.normalOS);
                float3 worldPos = TransformObjectToWorld(input.positionOS.xyz);
                output.viewDir = normalize(GetCameraPositionWS() - worldPos);
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 n = normalize(input.worldNormal);
                float3 v = normalize(input.viewDir);

                // Silhouette edge detection: dot(n, v) near zero
                float fresnel = 1.0 - saturate(abs(dot(n, v)));
                float edge = pow(fresnel, 1.0 / max(_EdgeWidth, 0.1));

                half4 col = lerp(_FillColor, _EdgeColor, edge);
                return col;
            }
            ENDHLSL
        }
    }
}
