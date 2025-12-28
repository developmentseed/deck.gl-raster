const vec3 D65 = vec3(
    0.95047, // Xn
    1.00000, // Yn
    1.08883 // Zn
);

vec3 cielabToRgb(vec3 labTex) {
    // labTex in [0,1] from RGB8 texture
    float L = labTex.r * 255.0;
    float a = (labTex.g - 0.5) * 255.0;
    float b = (labTex.b - 0.5) * 255.0;

    float y = (L + 16.0) / 116.0;
    float x = (a / 500.0) + y;
    float z = y - (b / 200.0);

    vec3 xyz;
    vec3 v = vec3(x, y, z);
    vec3 v3 = v * v * v;

    xyz = D65 * mix(
        (v - 16.0 / 116.0) / 7.787,
        v3,
        step(0.008856, v3)
    );

    vec3 rgb = mat3(
        3.2406, -1.5372, -0.4986,
        -0.9689, 1.8758, 0.0415,
        0.0557, -0.2040, 1.0570
    ) * xyz;

    // sRGB gamma
    rgb = mix(
        12.92 * rgb,
        1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055,
        step(0.0031308, rgb)
    );

    return clamp(rgb, 0.0, 1.0);
}
