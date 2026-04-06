# Design System Specification: The Academic Pulse

## 1. Overview & Creative North Star
This design system moves away from the "standard utility" look of student portals to embrace a Creative North Star we call **"The Scholarly Stream."** 

Inspired by the fluidity of high-end messaging platforms but elevated through editorial precision, the system prioritizes **Atmospheric Depth** over rigid containment. We reject the "boxed-in" feeling of traditional mobile apps. Instead, we use expansive breathing room, intentional asymmetry in header placements, and a sophisticated layering of surfaces to create an interface that feels like a premium, living document. 

The goal is a "Zero-Friction" experience where information isn't just displayed; it is choreographed.

---

## 2. Colors & Tonal Architecture
We utilize a sophisticated Material Design-inspired palette to move beyond flat colors into a world of depth and intentionality.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning. 
Boundaries must be defined solely through background color shifts. Use `surface-container-low` (#f3f4f5) to sit against the base `surface` (#f8f9fa). This creates a "soft-edge" layout that feels more organic and modern than a grid of boxes.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following tiers to define importance:
- **Base Layer:** `surface` (#f8f9fa) – The canvas.
- **Content Sections:** `surface-container-low` (#f3f4f5) – Use for secondary information zones.
- **Actionable Cards:** `surface-container-lowest` (#ffffff) – These provide a "pop" against the lower tiers.

### Signature Textures & Glass
To provide "soul," avoid flat Primary buttons. Apply a subtle linear gradient from `primary` (#004ac6) to `primary_container` (#2563eb) at a 135-degree angle. For floating navigation or top bars, utilize **Glassmorphism**: 
- **Fill:** `surface` at 70% opacity.
- **Effect:** Background Blur (20px).
- **Result:** Content bleeds through, making the layout feel integrated and premium.

---

## 3. Typography: The Editorial Voice
We use a dual-font strategy to balance authority with readability. 

*   **Display & Headlines (Plus Jakarta Sans):** Used for impactful moments. The semi-bold weight provides an authoritative, editorial feel. 
*   **Body & Labels (Manrope):** Chosen for its exceptional legibility at small scales, replacing standard sans-serifs with a more contemporary, rhythmic character.

| Role | Token | Font | Size | Weight |
| :--- | :--- | :--- | :--- | :--- |
| **Hero Title** | `display-sm` | Plus Jakarta Sans | 2.25rem | SemiBold |
| **Section Header** | `headline-sm` | Plus Jakarta Sans | 1.5rem | SemiBold |
| **Sub-Header** | `title-md` | Manrope | 1.125rem | Medium |
| **Main Body** | `body-md` | Manrope | 0.875rem | Regular |
| **Metadata** | `label-sm` | Manrope | 0.6875rem | Light |

---

## 4. Elevation & Depth
In this system, depth is a function of light and tone, not structure.

*   **The Layering Principle:** To create a "lifted" card, place a `surface_container_lowest` container on a `surface_container` background. The slight shift in hex value creates a natural edge.
*   **Ambient Shadows:** When a shadow is required for a Floating Action Button (FAB) or a Modal, use a "Cloud Shadow."
    *   **Blur:** 24px - 32px.
    *   **Opacity:** 6% of `on_surface` (#191c1d).
    *   **Color:** Tint the shadow with 2% of `primary` to make it feel cohesive with the brand.
*   **The Ghost Border Fallback:** If accessibility requires a stroke (e.g., in high-contrast mode), use `outline_variant` (#c3c6d7) at **15% opacity**. Never use a 100% opaque border.

---

## 5. Signature Components

### Interaction Primitive: The Fluid Button
- **Primary:** Gradient fill (`primary` to `primary_container`), `xl` (1.5rem) corner radius. No border.
- **Secondary:** `surface_container_high` background with `on_primary_fixed_variant` text.
- **States:** On press, the button should scale down to 97% to simulate a physical "click."

### Message Bubbles (The "Pulse" Style)
Inspired by modern messaging, bubbles use asymmetrical rounding:
- **Outgoing:** `primary_container` fill, `on_primary` text. Corners: `lg`, `lg`, `sm`, `lg`.
- **Incoming:** `surface_container_highest` fill, `on_surface` text. Corners: `lg`, `lg`, `lg`, `sm`.

### Input Fields
Abandon the four-sided box. Use a `surface_container_low` background with a `full` (pill-shaped) radius. The label sits in `label-md` floating above the input, never inside it, to maintain a clean "uncluttered" look.

### Cards & Lists: The No-Divider Rule
Forbid the use of horizontal rules (`<hr>`). 
- **Separation:** Use a `12` (3rem) spacing gap or a background shift between `surface` and `surface_container_low`. 
- **Grouping:** Group related student data within a single container rather than separating them with lines.

### Additional Component: The "Live Status" Chip
A small, semi-transparent chip (e.g., "In Class" or "Exam Mode"). Use `secondary_container` at 40% opacity with `on_secondary_container` text. This adds a layer of sophisticated transparency that feels "Pro."

---

## 6. Do's and Don'ts

### Do
- **Do** use `20` (5rem) of top padding for headers to let the typography breathe.
- **Do** use `xl` (1.5rem) corner radius for main containers to keep the UI "friendly" and tactile.
- **Do** align metadata to the right in lists to create an asymmetrical, editorial rhythm.

### Don't
- **Don't** use pure black (#000000) for text. Always use `on_surface` (#191c1d) to maintain tonal softness.
- **Don't** use standard "drop shadows" with 0 blur. It shatters the high-end aesthetic.
- **Don't** use dividers. If the content feels cluttered, increase the spacing scale (`8` to `10`) rather than adding a line.