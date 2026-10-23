#!/usr/bin/env python3
"""
3D Botanical Lily Bouquet — Procedural Parametric Construction & Animation
==========================================================================
Generates a vertical 9:16 (1080x1920) cinematic 3D animation of a realistic
bunch of Oriental Lilies (Lilium orientalis) progressively drawn, constructed,
and revealed through parametric 3D curves, subsurface-scattered meshes,
stamens, pistils, buds, stems, and lanceolate leaves.
"""

import os
import sys
import math
import time
import subprocess
import multiprocessing as mp
import numpy as np
import cv2

# ============================================================================
# CONFIGURATION (9:16 Instagram Reel Format)
# ============================================================================
WIDTH = 1080
HEIGHT = 1920
FPS = 30
DURATION = 13.0
TOTAL_FRAMES = int(FPS * DURATION)  # 390 frames
SHIFT = 3
SUBPIX = 1 << SHIFT  # 8x subpixel precision for OpenCV rasterization


# ============================================================================
# MATHEMATICAL & EASING UTILITIES
# ============================================================================
def clamp(x, lo=0.0, hi=1.0):
    return np.clip(x, lo, hi)


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / max(1e-8, (edge1 - edge0)), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smootherstep(edge0, edge1, x):
    t = np.clip((x - edge0) / max(1e-8, (edge1 - edge0)), 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def normalize_v3(v):
    norm = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(norm, 1e-8)


def rot_x(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float32)


def rot_y(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float32)


def rot_z(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float32)


def build_basis_from_dir(direction, up_hint=np.array([0.0, 1.0, 0.0], dtype=np.float32)):
    """Construct an orthonormal 3x3 basis matrix whose local Y-axis aligns with `direction`."""
    y_axis = direction / max(1e-8, np.linalg.norm(direction))
    if abs(np.dot(y_axis, up_hint)) > 0.95:
        up_hint = np.array([0.0, 0.0, 1.0], dtype=np.float32)
    x_axis = np.cross(up_hint, y_axis)
    x_axis /= max(1e-8, np.linalg.norm(x_axis))
    z_axis = np.cross(x_axis, y_axis)
    z_axis /= max(1e-8, np.linalg.norm(z_axis))
    return np.stack([x_axis, y_axis, z_axis], axis=-1).astype(np.float32)


def eval_cubic_bezier(p0, p1, p2, p3, u):
    """Evaluate 3D cubic bezier curve and its tangent at parameter array u in [0, 1]."""
    u = np.asarray(u, dtype=np.float32)[..., None]
    om = 1.0 - u
    pos = (om ** 3) * p0 + 3.0 * (om ** 2) * u * p1 + 3.0 * om * (u ** 2) * p2 + (u ** 3) * p3
    tan = 3.0 * (om ** 2) * (p1 - p0) + 6.0 * om * u * (p2 - p1) + 3.0 * (u ** 2) * (p3 - p2)
    return pos, tan


def compute_bishop_frame(T):
    """Compute a twist-free Bishop parallel transport frame (N1, N2) along tangent array T (Nu, 3)."""
    Nu = len(T)
    N1 = np.zeros_like(T)
    N2 = np.zeros_like(T)
    t0 = T[0]
    ref = np.array([0.0, 0.0, 1.0], dtype=np.float32)
    if abs(np.dot(t0, ref)) > 0.9:
        ref = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    n1 = np.cross(t0, ref)
    n1 /= max(1e-8, np.linalg.norm(n1))
    n2 = np.cross(t0, n1)
    N1[0], N2[0] = n1, n2

    for i in range(1, Nu):
        ti = T[i]
        n1_proj = n1 - np.dot(n1, ti) * ti
        norm_n1 = np.linalg.norm(n1_proj)
        if norm_n1 < 1e-6:
            n1_proj = np.cross(ti, n2)
            norm_n1 = np.linalg.norm(n1_proj)
        n1 = n1_proj / max(1e-8, norm_n1)
        n2 = np.cross(ti, n1)
        N1[i], N2[i] = n1, n2
    return N1, N2


# ============================================================================
# 3D BOTANICAL GEOMETRY & SHADING ENGINE
# ============================================================================
class BotanicalElement:
    """
    Stores a parametric 3D surface mesh P(u, v) of shape (Nu, Nv, 3),
    vertex normals N(u, v), base diffuse RGB colors C(u, v) in [0, 1],
    optional 3D botanical papillae spots, and timing interval for progressive construction.
    """
    def __init__(self, kind, P, C, u_grid, v_grid, wire_t0, wire_t1, surf_t0, surf_t1,
                 sss_strength=0.35, spec_strength=0.25, shininess=18.0,
                 wire_color=(0.95, 0.78, 0.55), wire_stride_u=4, wire_stride_v=3,
                 is_petal=False, P_closed=None, papillae=None):
        self.kind = kind
        self.P = P.astype(np.float32)
        self.P_closed = P_closed.astype(np.float32) if P_closed is not None else None
        self.C = np.clip(C, 0.0, 1.0).astype(np.float32)
        self.u_grid = u_grid.astype(np.float32)
        self.v_grid = v_grid.astype(np.float32)
        self.wire_t0 = wire_t0
        self.wire_t1 = wire_t1
        self.surf_t0 = surf_t0
        self.surf_t1 = surf_t1
        self.sss_strength = sss_strength
        self.spec_strength = spec_strength
        self.shininess = shininess
        self.wire_color = np.array(wire_color, dtype=np.float32)
        self.wire_stride_u = wire_stride_u
        self.wire_stride_v = wire_stride_v
        self.is_petal = is_petal
        self.papillae = papillae or []  # list of (u_idx, v_idx, radius_px, bgr_core, bgr_rim, eff_u)

    def get_positions_and_normals(self, bloom_t=1.0):
        if self.P_closed is not None and bloom_t < 0.999:
            P = self.P_closed * (1.0 - bloom_t) + self.P * bloom_t
        else:
            P = self.P
        p00 = P[:-1, :-1]
        p10 = P[1:, :-1]
        p11 = P[1:, 1:]
        p01 = P[:-1, 1:]
        d_u = 0.5 * ((p10 - p00) + (p11 - p01))
        d_v = 0.5 * ((p01 - p00) + (p11 - p10))
        normals = normalize_v3(np.cross(d_v, d_u))
        return P, p00, p10, p11, p01, normals


def generate_stem_tube(p0, p1, p2, p3, r_base, r_tip, Nu, Nv,
                       col_base, col_tip, wire_t0, wire_t1, surf_t0, surf_t1):
    """Generate a smooth, twist-free 3D tubular stem or pedicel along a cubic Bezier spline."""
    u = np.linspace(0.0, 1.0, Nu, dtype=np.float32)
    v = np.linspace(-1.0, 1.0, Nv, dtype=np.float32)
    U, V = np.meshgrid(u, v, indexing='ij')
    theta = (V + 1.0) * math.pi

    pos, tan = eval_cubic_bezier(p0, p1, p2, p3, u)
    T = normalize_v3(tan)
    N1, N2 = compute_bishop_frame(T)

    P = np.zeros((Nu, Nv, 3), dtype=np.float32)
    C = np.zeros((Nu, Nv, 3), dtype=np.float32)
    for i in range(Nu):
        n1, n2 = N1[i], N2[i]
        r = r_base * (1.0 - u[i]) + r_tip * u[i]
        if u[i] > 0.90:
            r *= 1.0 + 0.25 * smoothstep(0.90, 1.0, u[i])
        ridge = 1.0 + 0.025 * np.cos(6.0 * theta[i])
        rad = r * ridge
        P[i] = pos[i] + rad[:, None] * (np.cos(theta[i])[:, None] * n1 + np.sin(theta[i])[:, None] * n2)

        mix = u[i]
        base_c = (1.0 - mix) * col_base + mix * col_tip
        striation = 0.95 + 0.05 * np.cos(6.0 * theta[i])[:, None]
        C[i] = base_c * striation

    return BotanicalElement(
        kind="stem", P=P, C=C, u_grid=U, v_grid=V,
        wire_t0=wire_t0, wire_t1=wire_t1, surf_t0=surf_t0, surf_t1=surf_t1,
        sss_strength=0.22, spec_strength=0.25, shininess=18.0,
        wire_color=(0.38, 0.88, 0.50), wire_stride_u=6, wire_stride_v=4
    ), pos, T


def generate_lanceolate_leaf(origin, stem_dir, azimuth, length, width, arch_drop, twist,
                             wire_t0, wire_t1, surf_t0, surf_t1):
    """Generate a realistic 3D lanceolate lily leaf with parallel venation and natural arch."""
    Nu, Nv = 36, 17
    u = np.linspace(0.0, 1.0, Nu, dtype=np.float32)
    v = np.linspace(-1.0, 1.0, Nv, dtype=np.float32)
    U, V = np.meshgrid(u, v, indexing='ij')

    w_prof = (
        width * (np.maximum(0.0, np.sin(math.pi * (U ** 0.66))) ** 0.92) * (1.0 - 0.12 * U)
        + 0.10 * width * ((1.0 - U) ** 3)
    )

    reach = length * (0.90 * U + 0.10 * np.sin(0.5 * math.pi * U))
    elev = length * (0.46 * U - arch_drop * (U ** 2.1))

    fold = 0.055 * width * (np.abs(V) ** 1.35) * (1.0 - 0.45 * U) - 0.025 * width * (V ** 4)
    tw_ang = twist * (U ** 1.35)
    x_loc = w_prof * V * np.cos(tw_ang) - fold * np.sin(tw_ang)
    z_loc = elev + w_prof * V * np.sin(tw_ang) + fold * np.cos(tw_ang)
    y_loc = reach

    P_local = np.stack([x_loc, z_loc, y_loc], axis=-1)
    rot = rot_y(azimuth)
    P_world = origin + P_local @ rot.T

    c_dark = np.array([0.08, 0.27, 0.12], dtype=np.float32)
    c_mid = np.array([0.16, 0.45, 0.19], dtype=np.float32)
    c_vein = np.array([0.36, 0.65, 0.30], dtype=np.float32)
    c_tip = np.array([0.24, 0.50, 0.18], dtype=np.float32)

    midrib_mask = np.exp(-((V / 0.10) ** 2))[..., None]
    parallel_veins = (0.5 + 0.5 * np.cos(V * 8.0 * math.pi))[..., None] ** 4
    edge_grad = (np.abs(V) ** 1.4)[..., None]

    C = (1.0 - edge_grad) * c_mid + edge_grad * c_dark
    C = C * (1.0 - 0.32 * (U ** 2)[..., None]) + c_tip * (0.32 * (U ** 2)[..., None])
    C = C * (1.0 - 0.48 * midrib_mask) + c_vein * (0.48 * midrib_mask)
    C = C + 0.06 * parallel_veins * c_vein

    return BotanicalElement(
        kind="leaf", P=P_world, C=C, u_grid=U, v_grid=V,
        wire_t0=wire_t0, wire_t1=wire_t1, surf_t0=surf_t0, surf_t1=surf_t1,
        sss_strength=0.30, spec_strength=0.35, shininess=24.0,
        wire_color=(0.45, 0.92, 0.54), wire_stride_u=7, wire_stride_v=4
    )


def generate_lily_tepal(center, basis, azimuth, is_inner, scale, openness,
                        color_variant, wire_t0, wire_t1, surf_t0, surf_t1, rng_seed):
    """
    Generate a high-resolution 3D Oriental Lily tepal (inner petal or outer sepal)
    with non-intersecting inner/outer whorl nesting, lush ovate-elliptic blade,
    recurved tip, marginal ruffling, and 3D raised botanical papillae.
    """
    rng = np.random.RandomState(rng_seed)
    Nu, Nv = 84, 41  # High mesh density for velvety continuous shading
    u = np.linspace(0.0, 1.0, Nu, dtype=np.float32)
    v = np.linspace(-1.0, 1.0, Nv, dtype=np.float32)
    U, V = np.meshgrid(u, v, indexing='ij')

    # Broad, lush Oriental Lily petal silhouette (rounded belly, graceful acuminate tip)
    w_max = (0.46 if is_inner else 0.39) * scale
    length = (1.26 if is_inner else 1.24) * scale

    envelope = np.maximum(0.0, np.sin(math.pi * (U ** 0.58))) ** 0.72
    tip_round = 1.0 - 0.12 * (U ** 3)
    w_profile = w_max * envelope * tip_round + 0.055 * scale * ((1.0 - U) ** 2.6)

    def build_tepal_surface(open_factor):
        # Inner whorl sits strictly inside the outer whorl in the throat/cup region
        theta_base = (0.18 if is_inner else 0.30)
        theta_flare = (0.74 if is_inner else 0.88) * open_factor + 0.14
        theta_recurve = (1.55 if is_inner else 1.72) * (open_factor ** 1.18)

        u_1d = u
        angles = (
            theta_base
            + theta_flare * smoothstep(0.04, 0.58, u_1d)
            + (theta_recurve - theta_flare) * (smoothstep(0.42, 1.0, u_1d) ** 1.25)
        )
        ds = length / (Nu - 1)
        r_mid = np.zeros(Nu, dtype=np.float32)
        y_mid = np.zeros(Nu, dtype=np.float32)
        r_mid[0] = (0.036 if is_inner else 0.078) * scale
        y_mid[0] = (0.035 if is_inner else 0.00) * scale
        for i in range(1, Nu):
            ang = 0.5 * (angles[i - 1] + angles[i])
            r_mid[i] = r_mid[i - 1] + ds * math.sin(ang)
            y_mid[i] = y_mid[i - 1] + ds * math.cos(ang)

        R_mid = r_mid[:, None]
        Y_mid = y_mid[:, None]
        Ang = angles[:, None]

        # Outward normal to midrib curve in (r, y) plane: (cos(Ang), -sin(Ang))
        out_r = np.cos(Ang)
        out_y = -np.sin(Ang)

        # Central nectary furrow + reflexed upper blade + marginal ruffling
        furrow = 0.028 * scale * np.exp(-((V / 0.16) ** 2)) * (1.0 - 0.60 * U)
        reflex = 0.045 * scale * (V ** 2) * smoothstep(0.35, 0.90, U)

        ruffle_amp = (0.044 if is_inner else 0.028) * scale * open_factor
        ruffle_env = np.maximum(0.0, np.sin(math.pi * U)) * smoothstep(0.15, 0.88, U) * (np.abs(V) ** 2.3)
        phase = 0.85 if is_inner else -0.75
        ruffle = ruffle_amp * ruffle_env * np.sin(6.0 * math.pi * U + phase * np.sign(V))

        disp_out = furrow + reflex + ruffle

        # Cylindrical-to-planar transverse wrapping so inner whorl stays cleanly inside outer whorl
        wrap_r = R_mid + 0.16 * scale
        phi_local = (w_profile * V) / wrap_r
        # Blend from cylindrical wrap in throat/cup (u < 0.55) to broader planar flare near tip
        cyl_blend = 1.0 - 0.55 * smoothstep(0.35, 0.85, U)
        phi_eff = phi_local * cyl_blend
        x_planar = (w_profile * V) * (1.0 - cyl_blend)

        r_base_surf = wrap_r * np.cos(phi_eff) - 0.16 * scale + disp_out * out_r
        x_base_surf = wrap_r * np.sin(phi_eff) + x_planar
        y_local = Y_mid + disp_out * out_y

        ca, sa = math.cos(azimuth), math.sin(azimuth)
        px = x_base_surf * ca + r_base_surf * sa
        pz = -x_base_surf * sa + r_base_surf * ca
        py = y_local

        P_flower = np.stack([px, py, pz], axis=-1)
        return center + P_flower @ basis.T

    P_full = build_tepal_surface(openness)
    P_semi = build_tepal_surface(max(0.28, openness * 0.45))

    # ========================================================================
    # SMOOTH BOTANICAL PIGMENTATION (Velvety Gradient + Venation)
    # ========================================================================
    c_nectar = np.array([0.38, 0.68, 0.18], dtype=np.float32)       # Lime-emerald basal throat star
    c_ivory = np.array([0.99, 0.97, 0.96], dtype=np.float32)        # Pure snow-ivory margin & tip
    if color_variant == "stargazer":
        c_deep = np.array([0.74, 0.08, 0.31], dtype=np.float32)     # Rich crimson-magenta heart
        c_blush = np.array([0.93, 0.38, 0.58], dtype=np.float32)    # Vibrant rose-pink mid-blade
        pap_core_bgr = (30, 8, 92)                                  # Dark ruby papilla core (BGR)
        pap_rim_bgr = (72, 22, 155)                                 # Soft crimson-rose halo (BGR)
    elif color_variant == "soft_rose":
        c_deep = np.array([0.82, 0.18, 0.42], dtype=np.float32)
        c_blush = np.array([0.95, 0.54, 0.69], dtype=np.float32)
        pap_core_bgr = (42, 14, 112)
        pap_rim_bgr = (95, 38, 178)
    else:  # "blush_ivory"
        c_deep = np.array([0.85, 0.28, 0.48], dtype=np.float32)
        c_blush = np.array([0.96, 0.66, 0.77], dtype=np.float32)
        pap_core_bgr = (52, 20, 125)
        pap_rim_bgr = (110, 52, 190)

    C = np.broadcast_to(c_ivory, (Nu, Nv, 3)).copy()

    # Smooth crimson/rose flush radiating from throat and fading into pure white ruffled margins
    u_flush = smoothstep(0.05, 0.20, U) * (1.0 - smoothstep(0.48, 0.86, U))
    v_margin = 1.0 - smoothstep(0.32, 0.78, np.abs(V))
    flush_mask = (u_flush * v_margin)[..., None]

    core_mask = (
        smoothstep(0.07, 0.18, U)
        * (1.0 - smoothstep(0.38, 0.74, U))
        * np.exp(-((V / 0.40) ** 2))
    )[..., None]

    C = C * (1.0 - flush_mask) + c_blush * flush_mask
    C = C * (1.0 - 0.85 * core_mask) + c_deep * (0.85 * core_mask)

    # Emerald-green basal nectar star
    nectar_mask = (
        (1.0 - smoothstep(0.04, 0.24, U))
        * np.exp(-((V / (0.36 - 0.18 * U)) ** 2))
    )[..., None]
    C = C * (1.0 - 0.90 * nectar_mask) + c_nectar * (0.90 * nectar_mask)

    # Central midrib keel line extending up the tepal
    midrib_vein = (
        smoothstep(0.14, 0.28, U)
        * (1.0 - smoothstep(0.58, 0.92, U))
        * np.exp(-((V / 0.058) ** 2))
    )[..., None]
    c_midrib = 0.78 * c_deep + 0.22 * c_ivory
    C = C * (1.0 - 0.70 * midrib_vein) + c_midrib * (0.70 * midrib_vein)

    # Delicate longitudinal parallel venation
    vein_rib = (0.5 + 0.5 * np.cos(V * 18.0 * math.pi))[..., None]
    vein_strength = 0.045 * (1.0 - nectar_mask) * smoothstep(0.08, 0.88, U)[..., None]
    C = C - vein_strength * (1.0 - vein_rib) * np.array([0.05, 0.11, 0.07], dtype=np.float32)

    # Generate discrete 3D botanical papillae spots (rendered as crisp subpixel AA circles on surface)
    papillae = []
    n_pap = 68 if is_inner else 46
    for _ in range(n_pap):
        pu = rng.uniform(0.15, 0.62)
        pv_side = -1.0 if rng.uniform() < 0.5 else 1.0
        pv = pv_side * rng.uniform(0.07, 0.62)
        u_idx = int(np.clip(round(pu * (Nu - 1)), 1, Nu - 2))
        v_idx = int(np.clip(round(((pv + 1.0) * 0.5) * (Nv - 1)), 1, Nv - 2))
        rad_px = rng.uniform(1.6, 2.9) * scale
        eff_u = 0.85 * pu + 0.15 * abs(pv)
        papillae.append((u_idx, v_idx, rad_px, pap_core_bgr, pap_rim_bgr, eff_u))

    return BotanicalElement(
        kind="petal", P=P_full, P_closed=P_semi, C=C, u_grid=U, v_grid=V,
        wire_t0=wire_t0, wire_t1=wire_t1, surf_t0=surf_t0, surf_t1=surf_t1,
        sss_strength=0.46, spec_strength=0.26, shininess=22.0,
        wire_color=(1.0, 0.72, 0.84), wire_stride_u=10, wire_stride_v=5,
        is_petal=True, papillae=papillae
    )


def generate_stamens_and_pistil(center, basis, scale, wire_t0, wire_t1, surf_t0, surf_t1):
    """
    Generate the 6 curving stamens (slender filaments + versatile pollen-dusted anthers)
    and 1 central pistil (style + 3-lobed velvety stigma) of a lily flower.
    """
    elements = []

    # 1. Central Pistil (Style + Smooth 3-Lobed Stigma)
    Nu_s, Nv_s = 28, 13
    u = np.linspace(0.0, 1.0, Nu_s, dtype=np.float32)
    v = np.linspace(-1.0, 1.0, Nv_s, dtype=np.float32)
    U, V = np.meshgrid(u, v, indexing='ij')
    theta = (V + 1.0) * math.pi

    p0 = np.array([0.0, 0.0, 0.0], dtype=np.float32)
    p1 = np.array([0.02, 0.36, 0.03], dtype=np.float32) * scale
    p2 = np.array([0.04, 0.72, 0.07], dtype=np.float32) * scale
    p3 = np.array([0.02, 1.02, 0.14], dtype=np.float32) * scale
    pos, tan = eval_cubic_bezier(p0, p1, p2, p3, u)
    T = normalize_v3(tan)
    N1, N2 = compute_bishop_frame(T)

    P_style = np.zeros((Nu_s, Nv_s, 3), dtype=np.float32)
    C_style = np.zeros((Nu_s, Nv_s, 3), dtype=np.float32)
    c_green = np.array([0.52, 0.76, 0.30], dtype=np.float32)
    c_stigma = np.array([0.62, 0.18, 0.35], dtype=np.float32)

    for i in range(Nu_s):
        n1, n2 = N1[i], N2[i]
        tip_close = math.sin(math.pi * float(u[i])) ** 0.22 if u[i] > 0.92 else 1.0
        base_r = scale * 0.020 * (1.0 - 0.20 * u[i])
        if u[i] > 0.84:
            sw = math.sin(math.pi * (float(u[i]) - 0.84) / 0.16)
            lobe = 1.0 + 0.45 * np.cos(3.0 * theta[i])
            r = (base_r + scale * 0.022 * sw * lobe) * tip_close
        else:
            r = np.full_like(theta[i], base_r)
        P_style[i] = pos[i] + r[:, None] * (np.cos(theta[i])[:, None] * n1 + np.sin(theta[i])[:, None] * n2)
        stigma_mix = smoothstep(0.82, 0.92, u[i])
        C_style[i] = (1.0 - stigma_mix) * c_green + stigma_mix * c_stigma

    P_style_world = center + P_style @ basis.T
    elements.append(BotanicalElement(
        kind="pistil", P=P_style_world, C=C_style, u_grid=U, v_grid=V,
        wire_t0=wire_t0, wire_t1=wire_t1, surf_t0=surf_t0, surf_t1=surf_t1,
        sss_strength=0.30, spec_strength=0.38, shininess=28.0,
        wire_color=(0.75, 0.95, 0.55), wire_stride_u=6, wire_stride_v=4
    ))

    # 2. Six Curved Filaments + Versatile Pollen Anthers
    for k in range(6):
        az = k * (math.pi / 3.0) + 0.26
        ca, sa = math.cos(az), math.sin(az)
        flare = (0.27 + 0.03 * (k % 2)) * scale
        h_tip = (0.88 + 0.04 * (k % 3)) * scale

        fp0 = np.array([0.028 * scale * ca, 0.02 * scale, 0.028 * scale * sa], dtype=np.float32)
        fp1 = np.array([0.075 * scale * ca, 0.34 * scale, 0.075 * scale * sa], dtype=np.float32)
        fp2 = np.array([0.195 * scale * ca, 0.68 * scale, 0.195 * scale * sa], dtype=np.float32)
        fp3 = np.array([flare * ca, h_tip, flare * sa], dtype=np.float32)

        Nu_f, Nv_f = 22, 8
        uf = np.linspace(0.0, 1.0, Nu_f, dtype=np.float32)
        vf = np.linspace(-1.0, 1.0, Nv_f, dtype=np.float32)
        Uf, Vf = np.meshgrid(uf, vf, indexing='ij')
        th_f = (Vf + 1.0) * math.pi

        fpos, ftan = eval_cubic_bezier(fp0, fp1, fp2, fp3, uf)
        Tf = normalize_v3(ftan)
        N1f, N2f = compute_bishop_frame(Tf)

        P_fil = np.zeros((Nu_f, Nv_f, 3), dtype=np.float32)
        C_fil = np.zeros((Nu_f, Nv_f, 3), dtype=np.float32)
        c_fil_base = np.array([0.56, 0.80, 0.36], dtype=np.float32)
        c_fil_tip = np.array([0.98, 0.95, 0.96], dtype=np.float32)

        for i in range(Nu_f):
            rf = scale * (0.012 * (1.0 - 0.45 * uf[i]))
            P_fil[i] = fpos[i] + rf * (np.cos(th_f[i])[:, None] * N1f[i] + np.sin(th_f[i])[:, None] * N2f[i])
            mix = smoothstep(0.15, 0.75, uf[i])
            C_fil[i] = (1.0 - mix) * c_fil_base + mix * c_fil_tip

        P_fil_world = center + P_fil @ basis.T
        st_delay = 0.06 * k
        elements.append(BotanicalElement(
            kind="filament", P=P_fil_world, C=C_fil, u_grid=Uf, v_grid=Vf,
            wire_t0=wire_t0 + st_delay, wire_t1=wire_t1 + st_delay * 0.5,
            surf_t0=surf_t0 + st_delay, surf_t1=surf_t1 + st_delay * 0.5,
            sss_strength=0.35, spec_strength=0.25, shininess=20.0,
            wire_color=(0.95, 0.90, 0.65), wire_stride_u=5, wire_stride_v=3
        ))

        # Versatile Anther
        Nu_a, Nv_a = 14, 10
        ua = np.linspace(0.0, 1.0, Nu_a, dtype=np.float32)
        va = np.linspace(-1.0, 1.0, Nv_a, dtype=np.float32)
        Ua, Va = np.meshgrid(ua, va, indexing='ij')
        th_a = (Va + 1.0) * math.pi

        anther_len = 0.145 * scale
        rad_dir = np.array([ca, 0.0, sa], dtype=np.float32)
        tan_dir = np.array([-sa, 0.0, ca], dtype=np.float32)
        a_axis = normalize_v3(0.75 * tan_dir + 0.35 * np.array([0.0, 1.0, 0.0], dtype=np.float32) + 0.25 * rad_dir)
        a_n1 = normalize_v3(np.cross(a_axis, rad_dir))
        a_n2 = normalize_v3(np.cross(a_axis, a_n1))

        P_anth = np.zeros((Nu_a, Nv_a, 3), dtype=np.float32)
        C_anth = np.zeros((Nu_a, Nv_a, 3), dtype=np.float32)
        c_pollen_1 = np.array([0.76, 0.30, 0.07], dtype=np.float32)
        c_pollen_2 = np.array([0.94, 0.58, 0.14], dtype=np.float32)

        for i in range(Nu_a):
            s_along = (ua[i] - 0.5) * anther_len
            env = max(0.0, math.sin(math.pi * float(ua[i]))) ** 0.60
            bilobe = 1.0 + 0.28 * np.cos(2.0 * th_a[i])
            ra = 0.023 * scale * env * bilobe
            P_anth[i] = fp3 + s_along * a_axis + ra[:, None] * (
                np.cos(th_a[i])[:, None] * a_n1 + np.sin(th_a[i])[:, None] * a_n2
            )
            grain = 0.5 + 0.5 * np.sin(19.0 * ua[i] + 7.0 * th_a[i])[:, None]
            C_anth[i] = (1.0 - 0.45 * grain) * c_pollen_1 + (0.45 * grain) * c_pollen_2

        P_anth_world = center + P_anth @ basis.T
        elements.append(BotanicalElement(
            kind="anther", P=P_anth_world, C=C_anth, u_grid=Ua, v_grid=Va,
            wire_t0=wire_t0 + 0.25 + st_delay, wire_t1=wire_t1 + 0.20 + st_delay * 0.5,
            surf_t0=surf_t0 + 0.25 + st_delay, surf_t1=surf_t1 + st_delay * 0.5,
            sss_strength=0.22, spec_strength=0.15, shininess=10.0,
            wire_color=(1.0, 0.75, 0.25), wire_stride_u=4, wire_stride_v=3
        ))

    return elements


def generate_lily_bud(center, basis, scale, is_cracking, wire_t0, wire_t1, surf_t0, surf_t1):
    """Generate a realistic 3D unopened or slightly cracking Oriental Lily bud with 3 sepal ribs."""
    Nu, Nv = 34, 21
    u = np.linspace(0.0, 1.0, Nu, dtype=np.float32)
    v = np.linspace(-1.0, 1.0, Nv, dtype=np.float32)
    U, V = np.meshgrid(u, v, indexing='ij')
    theta = (V + 1.0) * math.pi

    length = 0.90 * scale
    r_prof = (
        0.21 * scale * (np.maximum(0.0, np.sin(math.pi * (U ** 0.66))) ** 1.12) * (1.0 - 0.12 * U)
        + 0.028 * scale * ((1.0 - U) ** 2)
    )
    rib = 1.0 + 0.08 * np.cos(3.0 * theta) * np.maximum(0.0, np.sin(math.pi * U))
    R = r_prof * rib
    Y = length * U

    px = R * np.cos(theta)
    pz = R * np.sin(theta)
    py = Y
    P_bud = center + np.stack([px, py, pz], axis=-1) @ basis.T

    c_green = np.array([0.34, 0.62, 0.22], dtype=np.float32)
    c_rose = np.array([0.86, 0.34, 0.54], dtype=np.float32)
    c_ivory = np.array([0.96, 0.92, 0.90], dtype=np.float32)

    rose_mix = smoothstep(0.24, 0.68, U)[..., None] * (1.0 - 0.45 * (0.5 + 0.5 * np.cos(3.0 * theta))[..., None])
    if not is_cracking:
        rose_mix *= 0.45
    tip_mix = smoothstep(0.78, 0.98, U)[..., None]

    C = (1.0 - rose_mix) * c_green + rose_mix * c_rose
    C = (1.0 - tip_mix) * C + tip_mix * c_ivory

    return BotanicalElement(
        kind="bud", P=P_bud, C=C, u_grid=U, v_grid=V,
        wire_t0=wire_t0, wire_t1=wire_t1, surf_t0=surf_t0, surf_t1=surf_t1,
        sss_strength=0.34, spec_strength=0.30, shininess=22.0,
        wire_color=(0.68, 0.92, 0.58), wire_stride_u=6, wire_stride_v=4
    )


# ============================================================================
# FULL LILY BOUQUET SCENE ASSEMBLY
# ============================================================================
def build_lily_bouquet_scene():
    """
    Construct the complete 3D botanical bouquet of Oriental Lilies:
    - 3 main arching stems + 5 branching pedicels
    - 15 whorled/alternate lanceolate leaves
    - 3 blooming lilies (Hero Center-Right, Hero Upper-Left, Trumpet Lower-Left)
    - 2 botanical lily buds (Top Crown & Right Flank)
    All timed for a seamless 13-second progressive construction & reveal.
    """
    elements = []

    c_stem_base = np.array([0.13, 0.35, 0.15], dtype=np.float32)
    c_stem_tip = np.array([0.32, 0.58, 0.24], dtype=np.float32)

    # 1. Main Stems (0.0s -> 2.4s)
    stems_spec = [
        (np.array([0.03, -2.55, 0.02]), np.array([0.09, -1.35, 0.06]),
         np.array([0.14, -0.35, 0.04]), np.array([0.10, 0.34, 0.10]), 0.048, 0.034, 0.0, 1.3, 0.3, 2.0),
        (np.array([-0.06, -2.55, -0.04]), np.array([-0.14, -1.25, -0.05]),
         np.array([-0.18, -0.10, -0.02]), np.array([-0.14, 0.82, -0.04]), 0.046, 0.032, 0.15, 1.5, 0.45, 2.2),
        (np.array([0.00, -2.55, -0.08]), np.array([-0.04, -1.40, -0.10]),
         np.array([0.02, -0.20, -0.09]), np.array([0.03, 1.28, -0.10]), 0.042, 0.027, 0.25, 1.7, 0.6, 2.4),
    ]

    stem_curves = []
    for p0, p1, p2, p3, rb, rt, wt0, wt1, st0, st1 in stems_spec:
        el, pos, tan = generate_stem_tube(
            np.array(p0, dtype=np.float32), np.array(p1, dtype=np.float32),
            np.array(p2, dtype=np.float32), np.array(p3, dtype=np.float32),
            rb, rt, 38, 13, c_stem_base, c_stem_tip, wt0, wt1, st0, st1
        )
        elements.append(el)
        stem_curves.append((pos, tan))

    # 2. Pedicels (0.85s -> 2.8s)
    pedicels_spec = [
        (np.array([0.12, 0.08, 0.07]), np.array([0.19, 0.20, 0.15]),
         np.array([0.24, 0.29, 0.23]), np.array([0.27, 0.36, 0.30]), 0.030, 0.025, 0.85, 1.9, 1.2, 2.4),
        (np.array([-0.15, 0.52, -0.03]), np.array([-0.23, 0.68, 0.04]),
         np.array([-0.29, 0.80, 0.10]), np.array([-0.34, 0.90, 0.15]), 0.028, 0.024, 1.0, 2.1, 1.35, 2.55),
        (np.array([-0.14, -0.45, -0.04]), np.array([-0.25, -0.34, 0.05]),
         np.array([-0.33, -0.25, 0.12]), np.array([-0.38, -0.18, 0.18]), 0.027, 0.023, 1.1, 2.2, 1.45, 2.65),
        (np.array([0.02, 1.12, -0.09]), np.array([0.05, 1.30, -0.06]),
         np.array([0.07, 1.46, -0.04]), np.array([0.08, 1.60, -0.02]), 0.025, 0.021, 1.25, 2.3, 1.6, 2.75),
        (np.array([0.10, 0.34, 0.10]), np.array([0.28, 0.66, 0.02]),
         np.array([0.42, 0.94, -0.04]), np.array([0.50, 1.16, -0.08]), 0.025, 0.021, 1.3, 2.35, 1.65, 2.8),
    ]
    for p0, p1, p2, p3, rb, rt, wt0, wt1, st0, st1 in pedicels_spec:
        el, _, _ = generate_stem_tube(
            np.array(p0, dtype=np.float32), np.array(p1, dtype=np.float32),
            np.array(p2, dtype=np.float32), np.array(p3, dtype=np.float32),
            rb, rt, 22, 11, c_stem_base, c_stem_tip, wt0, wt1, st0, st1
        )
        elements.append(el)

    # 3. Lanceolate Leaves along the stems (0.75s -> 3.6s)
    leaves_spec = [
        (0, 5,  0.45,  0.92, 0.17, 0.35,  0.20, 0.00),
        (0, 9,  2.35,  1.00, 0.18, 0.36, -0.16, 0.12),
        (0, 14, -1.15, 1.04, 0.19, 0.33,  0.22, 0.24),
        (0, 19, 0.85,  0.94, 0.17, 0.30, -0.18, 0.36),
        (0, 24, -0.55, 0.84, 0.16, 0.27,  0.14, 0.48),
        (0, 30, 1.65,  0.74, 0.14, 0.24, -0.14, 0.60),

        (1, 7,  -2.25, 0.94, 0.17, 0.35, -0.20, 0.10),
        (1, 12, 3.05,  1.02, 0.18, 0.34,  0.16, 0.22),
        (1, 17, -1.65, 0.98, 0.18, 0.32, -0.22, 0.34),
        (1, 23, 2.25,  0.88, 0.16, 0.29,  0.18, 0.46),
        (1, 29, -2.55, 0.78, 0.15, 0.25, -0.15, 0.58),

        (2, 10, -0.25, 0.88, 0.16, 0.34,  0.15, 0.20),
        (2, 16, 1.25,  0.92, 0.17, 0.31, -0.18, 0.35),
        (2, 22, -2.85, 0.82, 0.15, 0.28,  0.16, 0.50),
        (2, 28, 0.55,  0.72, 0.13, 0.24, -0.12, 0.65),
    ]
    for s_idx, u_idx, az, l_len, l_wid, arch, tw, dly in leaves_spec:
        pos_arr, tan_arr = stem_curves[s_idx]
        origin = pos_arr[u_idx]
        s_dir = tan_arr[u_idx]
        elements.append(generate_lanceolate_leaf(
            origin=origin, stem_dir=s_dir, azimuth=az,
            length=l_len, width=l_wid, arch_drop=arch, twist=tw,
            wire_t0=0.75 + dly, wire_t1=2.10 + dly,
            surf_t0=1.35 + dly, surf_t1=3.15 + dly
        ))

    # 4. Three Blooming Oriental Lilies
    flowers_spec = [
        # Flower 1: Hero Center-Right (Full Stargazer Oriental Lily)
        {
            "center": np.array([0.27, 0.36, 0.30], dtype=np.float32),
            "dir": np.array([0.22, 0.50, 0.84], dtype=np.float32),
            "scale": 0.90,
            "openness": 1.00,
            "variant": "stargazer",
            "rot_offset": 0.22,
            "wire_t0": 2.0, "wire_t1": 4.8,
            "surf_t0": 4.2, "surf_t1": 7.8,
            "stamen_t0": 7.0, "stamen_t1": 9.4,
            "seed_base": 100
        },
        # Flower 2: Hero Upper-Left (Full Soft-Rose Oriental Lily)
        {
            "center": np.array([-0.34, 0.90, 0.15], dtype=np.float32),
            "dir": np.array([-0.24, 0.58, 0.78], dtype=np.float32),
            "scale": 0.84,
            "openness": 0.95,
            "variant": "soft_rose",
            "rot_offset": 0.75,
            "wire_t0": 2.4, "wire_t1": 5.2,
            "surf_t0": 4.6, "surf_t1": 8.2,
            "stamen_t0": 7.3, "stamen_t1": 9.7,
            "seed_base": 200
        },
        # Flower 3: Lower-Left Trumpet-Stage Bloom
        {
            "center": np.array([-0.38, -0.18, 0.18], dtype=np.float32),
            "dir": np.array([-0.30, 0.46, 0.83], dtype=np.float32),
            "scale": 0.76,
            "openness": 0.82,
            "variant": "blush_ivory",
            "rot_offset": -0.32,
            "wire_t0": 2.8, "wire_t1": 5.5,
            "surf_t0": 5.0, "surf_t1": 8.5,
            "stamen_t0": 7.6, "stamen_t1": 9.9,
            "seed_base": 300
        },
    ]

    for f in flowers_spec:
        basis = build_basis_from_dir(f["dir"])
        for k in range(3):
            az = f["rot_offset"] + k * (2.0 * math.pi / 3.0)
            dly = 0.12 * k
            elements.append(generate_lily_tepal(
                center=f["center"], basis=basis, azimuth=az, is_inner=False,
                scale=f["scale"], openness=f["openness"], color_variant=f["variant"],
                wire_t0=f["wire_t0"] + dly, wire_t1=f["wire_t1"] + dly,
                surf_t0=f["surf_t0"] + dly, surf_t1=f["surf_t1"] + dly,
                rng_seed=f["seed_base"] + k
            ))
        for k in range(3):
            az = f["rot_offset"] + (k + 0.5) * (2.0 * math.pi / 3.0)
            dly = 0.18 + 0.12 * k
            elements.append(generate_lily_tepal(
                center=f["center"], basis=basis, azimuth=az, is_inner=True,
                scale=f["scale"], openness=f["openness"], color_variant=f["variant"],
                wire_t0=f["wire_t0"] + dly, wire_t1=f["wire_t1"] + dly,
                surf_t0=f["surf_t0"] + dly, surf_t1=f["surf_t1"] + dly,
                rng_seed=f["seed_base"] + 10 + k
            ))
        elements.extend(generate_stamens_and_pistil(
            center=f["center"], basis=basis, scale=f["scale"],
            wire_t0=f["stamen_t0"], wire_t1=f["stamen_t0"] + 1.3,
            surf_t0=f["stamen_t0"] + 0.4, surf_t1=f["stamen_t1"]
        ))

    # 5. Two Lily Buds (Crown & Right Flank)
    bud1_basis = build_basis_from_dir(np.array([0.06, 0.95, 0.16], dtype=np.float32))
    elements.append(generate_lily_bud(
        center=np.array([0.08, 1.60, -0.02], dtype=np.float32),
        basis=bud1_basis, scale=0.80, is_cracking=True,
        wire_t0=2.5, wire_t1=4.8, surf_t0=4.5, surf_t1=7.5
    ))

    bud2_basis = build_basis_from_dir(np.array([0.36, 0.90, 0.12], dtype=np.float32))
    elements.append(generate_lily_bud(
        center=np.array([0.50, 1.16, -0.08], dtype=np.float32),
        basis=bud2_basis, scale=0.74, is_cracking=False,
        wire_t0=2.7, wire_t1=5.0, surf_t0=4.7, surf_t1=7.7
    ))

    return elements


# ============================================================================
# STUDIO BACKGROUND, BOKEH PARTICLES & CAMERA PROJECTION
# ============================================================================
def create_studio_backdrop():
    """Precompute a rich 9:16 botanical studio backdrop with radial lighting."""
    y = np.linspace(-1.0, 1.0, HEIGHT, dtype=np.float32)[:, None]
    x = np.linspace(-1.0, 1.0, WIDTH, dtype=np.float32)[None, :]
    r2 = (x * 0.95) ** 2 + ((y + 0.08) * 0.75) ** 2
    glow = np.exp(-1.55 * r2)
    upper_warmth = np.exp(-2.2 * ((x - 0.15) ** 2 + (y + 0.32) ** 2))

    b = 14.0 + 24.0 * glow + 12.0 * upper_warmth
    g = 12.0 + 22.0 * glow + 10.0 * upper_warmth
    r = 16.0 + 26.0 * glow + 22.0 * upper_warmth

    bg = np.stack([b, g, r], axis=-1)
    return np.clip(bg, 0, 255).astype(np.uint8)


STUDIO_BG = create_studio_backdrop()


def project_points(P_world, cam_rot, cam_target, cam_dist, fov_scale):
    """Transform 3D world points into camera space and 2D screen coordinates."""
    P_rel = (P_world - cam_target) @ cam_rot.T
    z_depth = cam_dist - P_rel[..., 2]
    z_safe = np.maximum(z_depth, 0.2)
    sx = (WIDTH * 0.5) + (P_rel[..., 0] / z_safe) * fov_scale
    sy = (HEIGHT * 0.53) - (P_rel[..., 1] / z_safe) * fov_scale
    return sx, sy, z_depth, P_rel


def compute_lighting(normals_cam, base_rgb, sss_strength, spec_strength, shininess):
    """
    Physically-inspired 3D botanical studio shader:
    - Key directional light (warm sunlight from upper-left-front)
    - Fill hemisphere light (cool botanical sky/shadow tint)
    - Warm rim / back light + Subsurface Scattering (SSS) through thin petals
    - Waxy cuticle Blinn-Phong specular highlight
    """
    L_key = normalize_v3(np.array([-0.42, 0.62, 0.66], dtype=np.float32))
    L_fill = normalize_v3(np.array([0.65, -0.20, 0.73], dtype=np.float32))
    V_dir = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    nz = normals_cam[..., 2:3]
    N = np.where(nz < 0.0, -normals_cam, normals_cam)

    ndotl_key = np.sum(N * L_key, axis=-1, keepdims=True)
    diff_key = np.clip((ndotl_key + 0.25) / 1.25, 0.0, 1.0)

    ndotl_fill = np.sum(N * L_fill, axis=-1, keepdims=True)
    diff_fill = np.clip((ndotl_fill + 0.40) / 1.40, 0.0, 1.0)

    ndotv = np.clip(np.sum(N * V_dir, axis=-1, keepdims=True), 0.0, 1.0)
    fresnel_rim = (1.0 - ndotv) ** 2.2
    back_trans = np.clip(-ndotl_key * 0.6 + 0.45, 0.0, 1.0)
    sss = sss_strength * (0.55 * fresnel_rim + 0.45 * back_trans)

    H_key = normalize_v3(L_key + V_dir)
    ndoth = np.clip(np.sum(N * H_key, axis=-1, keepdims=True), 0.0, 1.0)
    spec = spec_strength * (ndoth ** shininess)

    key_col = np.array([1.04, 1.01, 0.98], dtype=np.float32)
    fill_col = np.array([0.78, 0.86, 0.95], dtype=np.float32)
    sss_col = np.array([1.05, 0.82, 0.88], dtype=np.float32)

    lit_rgb = (
        base_rgb * (0.24 + 0.72 * diff_key * key_col + 0.22 * diff_fill * fill_col)
        + base_rgb * sss * sss_col
        + spec * np.array([1.0, 0.98, 0.95], dtype=np.float32)
    )

    lit_rgb = np.clip(lit_rgb, 0.0, 1.35)
    lit_rgb = lit_rgb / (1.0 + 0.18 * lit_rgb) * 1.14
    return np.clip(lit_rgb, 0.0, 1.0)


# ============================================================================
# SINGLE-FRAME RENDERER
# ============================================================================
SCENE_ELEMENTS = None


def init_worker():
    global SCENE_ELEMENTS
    SCENE_ELEMENTS = build_lily_bouquet_scene()


def render_frame(frame_idx, total_frames=TOTAL_FRAMES):
    """Render frame `frame_idx` at 1080x1920 resolution and return BGR uint8 image."""
    global SCENE_ELEMENTS
    if SCENE_ELEMENTS is None:
        SCENE_ELEMENTS = build_lily_bouquet_scene()

    t = (frame_idx / max(1, total_frames - 1)) * DURATION
    canvas = STUDIO_BG.copy()

    # ------------------------------------------------------------------------
    # 1. Cinematic Camera Trajectory (Smooth rise + 3D parallax orbit)
    # ------------------------------------------------------------------------
    p_all = frame_idx / max(1, total_frames - 1)
    azimuth = -0.32 + 0.56 * smootherstep(0.0, 0.78, p_all) + 0.22 * math.sin(
        max(0.0, (p_all - 0.72) / 0.28) * math.pi
    )
    elevation = 0.06 + 0.10 * smootherstep(0.10, 0.65, p_all) - 0.03 * smootherstep(0.75, 1.0, p_all)

    cam_rot = rot_x(elevation) @ rot_y(azimuth)

    y_target = -0.50 * (1.0 - smootherstep(0.0, 0.32, p_all)) + 0.24 * smootherstep(0.15, 0.55, p_all)
    cam_target = np.array([-0.02, y_target, 0.08], dtype=np.float32)
    cam_dist = 5.05 - 0.20 * smootherstep(0.25, 0.85, p_all)
    fov_scale = 1660.0

    # ------------------------------------------------------------------------
    # 2. Collect Active 3D Quads, Papillae, Wireframe Curves & Wavefront Particles
    # ------------------------------------------------------------------------
    quad_pts_list = []
    quad_z_list = []
    quad_bgr_list = []

    papilla_draw_list = []  # (z_depth, sx_sub, sy_sub, rad_sub, core_bgr, rim_bgr)
    wire_lines = []
    wave_particles = []

    global_wire_alpha = 1.0 - smootherstep(9.6, 11.4, t)

    for el in SCENE_ELEMENTS:
        if t < el.wire_t0:
            continue

        w_prog = smootherstep(el.wire_t0, el.wire_t1, t)
        s_prog = smootherstep(el.surf_t0, el.surf_t1, t)

        if el.is_petal:
            bloom_t = 0.28 + 0.72 * smootherstep(el.surf_t0, min(DURATION, el.surf_t1 + 1.6), t)
        else:
            bloom_t = 1.0

        P, p00, p10, p11, p01, normals = el.get_positions_and_normals(bloom_t)
        normals_cam = normals @ cam_rot.T

        sx, sy, z_depth, _ = project_points(P, cam_rot, cam_target, cam_dist, fov_scale)

        # A. Collect active surface quads (progressive materialization along u and v)
        if s_prog > 0.001:
            u_q = 0.25 * (el.u_grid[:-1, :-1] + el.u_grid[1:, :-1] + el.u_grid[1:, 1:] + el.u_grid[:-1, 1:])
            v_q = 0.25 * (
                np.abs(el.v_grid[:-1, :-1]) + np.abs(el.v_grid[1:, :-1])
                + np.abs(el.v_grid[1:, 1:]) + np.abs(el.v_grid[:-1, 1:])
            )
            eff_u = 0.85 * u_q + 0.15 * v_q
            mask = eff_u <= (s_prog * 1.03)

            if np.any(mask):
                c_q = 0.25 * (el.C[:-1, :-1] + el.C[1:, :-1] + el.C[1:, 1:] + el.C[:-1, 1:])
                lit_rgb = compute_lighting(
                    normals_cam, c_q, el.sss_strength, el.spec_strength, el.shininess
                )

                if s_prog < 0.995:
                    dist_edge = (s_prog * 1.03) - eff_u
                    rim_glow = np.exp(-((dist_edge / 0.055) ** 2)) * (dist_edge >= 0.0)
                    glow_col = np.array([1.0, 0.86, 0.55], dtype=np.float32)
                    lit_rgb = np.clip(lit_rgb + 0.55 * rim_glow[..., None] * glow_col, 0.0, 1.0)

                q_x = np.stack([sx[:-1, :-1], sx[1:, :-1], sx[1:, 1:], sx[:-1, 1:]], axis=-1)
                q_y = np.stack([sy[:-1, :-1], sy[1:, :-1], sy[1:, 1:], sy[:-1, 1:]], axis=-1)
                cx_q = np.mean(q_x, axis=-1, keepdims=True)
                cy_q = np.mean(q_y, axis=-1, keepdims=True)
                dx_q = q_x - cx_q
                dy_q = q_y - cy_q
                d_len = np.maximum(np.hypot(dx_q, dy_q), 1e-4)
                q_x_exp = q_x + (dx_q / d_len) * 0.55
                q_y_exp = q_y + (dy_q / d_len) * 0.55

                pts_sub = np.stack([q_x_exp, q_y_exp], axis=-1)[mask]
                pts_int = np.rint(pts_sub * SUBPIX).astype(np.int32)

                z_q = 0.25 * (
                    z_depth[:-1, :-1] + z_depth[1:, :-1] + z_depth[1:, 1:] + z_depth[:-1, 1:]
                )[mask]
                bgr_q = np.rint(lit_rgb[mask][..., ::-1] * 255.0).astype(np.uint8)

                quad_pts_list.append(pts_int)
                quad_z_list.append(z_q)
                quad_bgr_list.append(bgr_q)

                if 0.03 < s_prog < 0.98:
                    edge_mask = (dist_edge > 0.0) & (dist_edge < 0.04)
                    ey, ex = np.where(edge_mask)
                    for idx_p in range(0, len(ey), 7):
                        iy, ix = ey[idx_p], ex[idx_p]
                        wave_particles.append((
                            float(sx[iy, ix]), float(sy[iy, ix]), float(z_depth[iy, ix]) - 0.03,
                            (165, 225, 255), 2.4
                        ))

                # Collect visible 3D raised papillae on inner face of petals
                if el.papillae:
                    for u_i, v_i, rad_px, core_bgr, rim_bgr, p_eff_u in el.papillae:
                        if p_eff_u <= (s_prog * 0.98):
                            n_z = float(normals_cam[min(u_i, normals_cam.shape[0] - 1),
                                                    min(v_i, normals_cam.shape[1] - 1), 2])
                            if abs(n_z) > 0.14:
                                px_i = int(round(float(sx[u_i, v_i])))
                                py_i = int(round(float(sy[u_i, v_i])))
                                # Compute local longitudinal tangent angle in 2D screen space for oval orientation
                                dx_u = float(sx[min(u_i + 1, sx.shape[0] - 1), v_i] - sx[max(u_i - 1, 0), v_i])
                                dy_u = float(sy[min(u_i + 1, sy.shape[0] - 1), v_i] - sy[max(u_i - 1, 0), v_i])
                                ang_deg = math.degrees(math.atan2(dy_u, dx_u))
                                r_maj = max(2, int(round(rad_px * 1.15)))
                                r_min = max(1, int(round(rad_px * 0.75)))
                                pz_d = float(z_depth[u_i, v_i]) - 0.032
                                papilla_draw_list.append((pz_d, px_i, py_i, r_maj, r_min, ang_deg, core_bgr, rim_bgr))

        # B. Collect 3D parametric wireframe curves
        wire_vis = global_wire_alpha * (1.0 - 0.82 * smootherstep(0.60, 1.0, s_prog))
        if w_prog > 0.01 and wire_vis > 0.04:
            Nu, Nv = P.shape[:2]
            max_u_idx = max(2, int(round(w_prog * Nu)))
            wc_bgr = tuple(int(round(c * 255.0 * (0.35 + 0.65 * wire_vis))) for c in el.wire_color[::-1])

            v_indices = list(range(0, Nv, el.wire_stride_v))
            if (Nv - 1) not in v_indices:
                v_indices.append(Nv - 1)
            for j in v_indices:
                pts_2d = np.stack([sx[:max_u_idx, j], sy[:max_u_idx, j]], axis=-1)
                pts_sub = np.rint(pts_2d * SUBPIX).astype(np.int32)
                z_m = float(np.mean(z_depth[:max_u_idx, j])) - 0.015
                wire_lines.append((pts_sub, z_m, wc_bgr, 1))
                if w_prog < 0.98 and (j % (el.wire_stride_v * 2) == 0):
                    tip_u = max_u_idx - 1
                    wave_particles.append((
                        float(sx[tip_u, j]), float(sy[tip_u, j]), float(z_depth[tip_u, j]) - 0.04,
                        (190, 240, 255), 3.0
                    ))

            for i in range(0, max_u_idx, el.wire_stride_u):
                pts_2d = np.stack([sx[i, :], sy[i, :]], axis=-1)
                pts_sub = np.rint(pts_2d * SUBPIX).astype(np.int32)
                z_m = float(np.mean(z_depth[i, :])) - 0.015
                wire_lines.append((pts_sub, z_m, wc_bgr, 1))

    # ------------------------------------------------------------------------
    # 3. Depth-Sort & Rasterize 3D Surface Mesh + Raised Botanical Papillae
    # ------------------------------------------------------------------------
    if quad_pts_list:
        all_pts = np.concatenate(quad_pts_list, axis=0)
        all_z = np.concatenate(quad_z_list, axis=0)
        all_bgr = np.concatenate(quad_bgr_list, axis=0).tolist()

        order = np.argsort(all_z)[::-1]
        papilla_draw_list.sort(key=lambda x: x[0], reverse=True)
        n_pap_total = len(papilla_draw_list)
        pap_ptr = 0

        for idx in order:
            qz = float(all_z[idx])
            while pap_ptr < n_pap_total and papilla_draw_list[pap_ptr][0] >= qz:
                _, px_i, py_i, r_maj, r_min, ang_deg, core_bgr, rim_bgr = papilla_draw_list[pap_ptr]
                cv2.ellipse(canvas, (px_i, py_i), (r_maj + 1, r_min + 1), ang_deg, 0, 360, rim_bgr, -1, lineType=cv2.LINE_AA)
                cv2.ellipse(canvas, (px_i, py_i), (r_maj, r_min), ang_deg, 0, 360, core_bgr, -1, lineType=cv2.LINE_AA)
                pap_ptr += 1

            cv2.fillConvexPoly(
                canvas, all_pts[idx], all_bgr[idx], lineType=cv2.LINE_AA, shift=SHIFT
            )

        while pap_ptr < n_pap_total:
            _, px_i, py_i, r_maj, r_min, ang_deg, core_bgr, rim_bgr = papilla_draw_list[pap_ptr]
            cv2.ellipse(canvas, (px_i, py_i), (r_maj + 1, r_min + 1), ang_deg, 0, 360, rim_bgr, -1, lineType=cv2.LINE_AA)
            cv2.ellipse(canvas, (px_i, py_i), (r_maj, r_min), ang_deg, 0, 360, core_bgr, -1, lineType=cv2.LINE_AA)
            pap_ptr += 1

    # ------------------------------------------------------------------------
    # 4. Overlay Parametric Wireframe Curves (With Additive Glow)
    # ------------------------------------------------------------------------
    if wire_lines:
        wire_layer = np.zeros_like(canvas)
        wire_lines.sort(key=lambda item: item[1], reverse=True)
        for pts_sub, _, wc_bgr, thick in wire_lines:
            cv2.polylines(
                wire_layer, [pts_sub], isClosed=False, color=wc_bgr,
                thickness=thick, lineType=cv2.LINE_AA, shift=SHIFT
            )
        canvas = cv2.addWeighted(canvas, 1.0, wire_layer, 0.58, 0.0)

    # ------------------------------------------------------------------------
    # 5. Floating Botanical Pollen & Construction Wavefront Particles
    # ------------------------------------------------------------------------
    particle_layer = np.zeros_like(canvas)
    rng_p = np.random.RandomState(42)
    n_ambient = 65
    amb_pos = rng_p.uniform([-1.0, -1.6, -0.8], [1.0, 1.8, 0.8], size=(n_ambient, 3)).astype(np.float32)
    amb_phase = rng_p.uniform(0.0, 2.0 * math.pi, size=n_ambient)
    amb_pos[:, 1] += 0.18 * t + 0.08 * np.sin(t * 1.5 + amb_phase)
    amb_pos[:, 1] = ((amb_pos[:, 1] + 1.6) % 3.4) - 1.6
    amb_pos[:, 0] += 0.08 * np.cos(t * 1.1 + amb_phase)

    asx, asy, azd, _ = project_points(amb_pos, cam_rot, cam_target, cam_dist, fov_scale)
    for i in range(n_ambient):
        px, py = int(round(asx[i])), int(round(asy[i]))
        if 0 <= px < WIDTH and 0 <= py < HEIGHT:
            twinkle = 0.4 + 0.6 * math.sin(t * 2.8 + amb_phase[i])
            rad = int(round((1.5 + 2.5 * (i % 3)) * (4.5 / max(2.5, azd[i]))))
            col = (
                int(95 * twinkle),
                int(175 * twinkle),
                int(235 * twinkle)
            )
            cv2.circle(particle_layer, (px, py), max(1, rad), col, -1, lineType=cv2.LINE_AA)

    for px, py, _, bgr, rad in wave_particles[:260]:
        ix, iy = int(round(px)), int(round(py))
        if 0 <= ix < WIDTH and 0 <= iy < HEIGHT:
            cv2.circle(particle_layer, (ix, iy), max(1, int(round(rad))), bgr, -1, lineType=cv2.LINE_AA)

    particle_blur = cv2.GaussianBlur(particle_layer, (0, 0), sigmaX=3.2)
    canvas = cv2.addWeighted(canvas, 1.0, particle_blur, 0.85, 0.0)
    canvas = cv2.addWeighted(canvas, 1.0, particle_layer, 0.55, 0.0)

    # ------------------------------------------------------------------------
    # 6. Soft Botanical Bloom & Vignette Polish
    # ------------------------------------------------------------------------
    bright = np.maximum(canvas.astype(np.float32) - 185.0, 0.0).astype(np.uint8)
    bloom = cv2.GaussianBlur(bright, (0, 0), sigmaX=18.0)
    canvas = cv2.addWeighted(canvas, 1.0, bloom, 0.50, 0.0)

    # HUD overlay (disabled to produce clean botanical animation without text)
    # draw_botanical_hud(canvas, t)

    return canvas


def draw_botanical_hud(canvas, t):
    """Draw understated, museum-style botanical specimen telemetry in the 9:16 safe zones."""
    hud_alpha = smootherstep(0.2, 0.9, t) * (1.0 - 0.35 * smootherstep(10.8, 12.2, t))
    if hud_alpha <= 0.02:
        return

    overlay = canvas.copy()
    c_main = (215, 225, 235)
    c_accent = (175, 195, 235)
    c_muted = (135, 150, 165)

    cv2.putText(
        overlay, "LILIUM ORIENTALIS", (68, 118),
        cv2.FONT_HERSHEY_SIMPLEX, 0.78, c_main, 2, cv2.LINE_AA
    )
    cv2.putText(
        overlay, "3D PARAMETRIC BOTANICAL RECONSTRUCTION  //  SPECIMEN NO. 04", (68, 152),
        cv2.FONT_HERSHEY_SIMPLEX, 0.42, c_muted, 1, cv2.LINE_AA
    )
    cv2.line(overlay, (68, 172), (380, 172), (90, 110, 130), 1, cv2.LINE_AA)

    if t < 2.3:
        stage_str = "STAGE 01 // VASCULAR STEMS & LANCEOLATE FOLIAGE"
        eq_str = "S(u,v) : Bezier Spline Transport + Parallel Venation"
    elif t < 4.6:
        stage_str = "STAGE 02 // 3D TEPAL ISOLINE BLUEPRINT"
        eq_str = "W(u) = w_max * sin(pi * u^0.58) + Ruffle(u,v)"
    elif t < 7.8:
        stage_str = "STAGE 03 // SUBSURFACE PIGMENTATION & PAPILLAE"
        eq_str = "SSS Shader + Nectar Guide + Recurved Tepal Unfurling"
    elif t < 10.2:
        stage_str = "STAGE 04 // ANDROECIUM ANTHERS & TRILOBED STIGMA"
        eq_str = "6 Versatile Filaments + Central Gynoecium Formation"
    else:
        stage_str = "STAGE 05 // COMPLETE BOTANICAL SPECIMEN REVEAL"
        eq_str = "Full 3D Bouquet Turntable Showcase"

    y_bot = HEIGHT - 135
    cv2.putText(
        overlay, stage_str, (68, y_bot),
        cv2.FONT_HERSHEY_SIMPLEX, 0.48, c_accent, 1, cv2.LINE_AA
    )
    cv2.putText(
        overlay, eq_str, (68, y_bot + 28),
        cv2.FONT_HERSHEY_SIMPLEX, 0.40, c_muted, 1, cv2.LINE_AA
    )

    prog = min(1.0, t / DURATION)
    bar_w = WIDTH - 136
    cv2.rectangle(overlay, (68, y_bot + 46), (68 + bar_w, y_bot + 50), (55, 65, 75), -1)
    cv2.rectangle(
        overlay, (68, y_bot + 46), (68 + int(bar_w * prog), y_bot + 50),
        (165, 195, 240), -1
    )

    cv2.addWeighted(overlay, hud_alpha * 0.85, canvas, 1.0 - hud_alpha * 0.85, 0.0, dst=canvas)


# ============================================================================
# CLI ENTRY POINT (TEST FRAMES OR FULL MP4 RENDER)
# ============================================================================
def render_preview_keyframes(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    init_worker()
    test_times = [1.8, 3.8, 6.4, 11.5]
    for sec in test_times:
        f_idx = int(round((sec / DURATION) * (TOTAL_FRAMES - 1)))
        t0 = time.time()
        img = render_frame(f_idx, TOTAL_FRAMES)
        out_path = os.path.join(out_dir, f"preview_{sec:.1f}s.png")
        cv2.imwrite(out_path, img)
        print(f"Rendered {out_path} in {time.time() - t0:.2f}s")


def render_full_video(output_mp4):
    print(f"Rendering {TOTAL_FRAMES} frames at {WIDTH}x{HEIGHT} ({FPS} fps)...")
    t_start = time.time()

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-pix_fmt", "bgr24",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_mp4,
    ]
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    num_workers = min(8, os.cpu_count() or 4)
    with mp.Pool(processes=num_workers, initializer=init_worker) as pool:
        for idx, frame in enumerate(pool.imap(render_frame, range(TOTAL_FRAMES), chunksize=4)):
            proc.stdin.write(frame.tobytes())
            if (idx + 1) % 30 == 0 or (idx + 1) == TOTAL_FRAMES:
                elapsed = time.time() - t_start
                fps_actual = (idx + 1) / max(1e-5, elapsed)
                print(f"  [{idx + 1:3d}/{TOTAL_FRAMES}] ({100.0 * (idx + 1) / TOTAL_FRAMES:5.1f}%) - {fps_actual:.1f} fps")

    proc.stdin.close()
    stderr_out = proc.stderr.read().decode("utf-8", errors="ignore")
    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"FFmpeg failed with exit code {ret}:\n{stderr_out}")

    print(f"Done! Saved high-quality MP4 to: {output_mp4} in {time.time() - t_start:.1f}s")


if __name__ == "__main__":
    out_folder = os.path.dirname(os.path.abspath(__file__))
    if "--preview" in sys.argv:
        render_preview_keyframes(out_folder)
    else:
        video_path = os.path.join(out_folder, "lily_3d_botanical_animation.mp4")
        render_full_video(video_path)
