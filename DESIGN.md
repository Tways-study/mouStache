---
name: mouStache
description: Your clipboard, well-groomed. A local clipboard manager for IT students, presented on a calm Apple-grade grey ground with one ink-blue voice.
colors:
  ground: "#f5f5f7"
  surface: "#ffffff"
  sunk: "#ebebf0"
  ink: "#1c1c1e"
  ink-2: "#48484d"
  ink-3: "#636369"
  line: "rgba(60, 60, 67, 0.14)"
  code-bg: "#f2f2f6"
  ground-dark: "#1c1c1e"
  surface-dark: "#2c2c2e"
  sunk-dark: "#161618"
  ink-dark: "#f2f2f5"
  ink-2-dark: "#c4c4cc"
  ink-3-dark: "#a1a1aa"
  line-dark: "rgba(235, 235, 245, 0.12)"
  code-bg-dark: "#1c1c1f"
  brand-ink: "#3458f0"
  on-accent: "#ffffff"
  accent-text-dark: "#8ea3ff"
  accent-soft: "rgba(52, 88, 240, 0.1)"
  accent-soft-dark: "rgba(125, 149, 255, 0.14)"
  brand-tile-start: "#0a84ff"
  brand-tile-end: "#5e5ce6"
  close-cta-ink: "#1f2a8a"
  terminal: "#17171a"
  terminal-text: "#e7e7ee"
  terminal-muted: "#a9a9b3"
  terminal-prompt: "#7d95ff"
  tag-code: "#5856d6"
  tag-code-soft: "rgba(88, 86, 214, 0.12)"
  tag-net: "#12807c"
  tag-net-soft: "rgba(31, 158, 154, 0.13)"
  tag-err: "#d1291f"
  tag-err-soft: "rgba(229, 56, 46, 0.11)"
  tag-pr: "#9a3cc7"
  tag-pr-soft: "rgba(175, 82, 222, 0.12)"
  tag-link: "#0063d1"
  tag-link-soft: "rgba(0, 122, 255, 0.11)"
  tag-data: "#b35f00"
  tag-data-soft: "rgba(224, 123, 0, 0.13)"
  tag-secret: "#5b5b61"
  tag-secret-soft: "rgba(110, 110, 115, 0.13)"
  tag-code-dark: "#a5a4ff"
  tag-code-soft-dark: "rgba(94, 92, 230, 0.24)"
  tag-net-dark: "#5fd4cf"
  tag-net-soft-dark: "rgba(31, 158, 154, 0.22)"
  tag-err-dark: "#ff8f87"
  tag-err-soft-dark: "rgba(229, 56, 46, 0.22)"
  tag-pr-dark: "#dea2f7"
  tag-pr-soft-dark: "rgba(175, 82, 222, 0.22)"
  tag-link-dark: "#78b6ff"
  tag-link-soft-dark: "rgba(0, 122, 255, 0.22)"
  tag-data-dark: "#ffb35c"
  tag-data-soft-dark: "rgba(224, 123, 0, 0.22)"
  tag-secret-dark: "#c7c7cc"
  tag-secret-soft-dark: "rgba(142, 142, 147, 0.22)"
typography:
  display:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "clamp(2.6rem, 4.4vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "clamp(2rem, 3.4vw, 3.1rem)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  lede:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  tag:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  keycap: "8px"
  chip: "9px"
  screenshot: "14px"
  frame: "22px"
  band: "32px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  2xl: "64px"
  section: "120px"
  gutter: "24px"
  wrap: "1240px"
components:
  button-primary:
    backgroundColor: "{colors.brand-ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "52px"
  button-small:
    backgroundColor: "{colors.brand-ink}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "52px"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
  button-light:
    backgroundColor: "#ffffff"
    textColor: "{colors.close-cta-ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "52px"
  keycap:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.keycap}"
    padding: "0.05em 0.45em 0.12em"
  tag-chip:
    backgroundColor: "{colors.tag-code-soft}"
    textColor: "{colors.tag-code}"
    typography: "{typography.tag}"
    rounded: "{rounded.chip}"
    padding: "0 12px"
    height: "30px"
  thread-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px 10px 12px"
  specimen-cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "26px"
  stage-frame:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.frame}"
    padding: "28px"
  film-control:
    backgroundColor: "rgba(28, 28, 30, 0.72)"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    size: "42px"
  terminal:
    backgroundColor: "{colors.terminal}"
    textColor: "{colors.terminal-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.frame}"
    padding: "24px 26px"
  close-band:
    textColor: "#ffffff"
    rounded: "{rounded.band}"
    padding: "96px 32px 104px"
  nav:
    textColor: "{colors.ink-2}"
    height: "68px"
---

# Design System: mouStache

## Overview

**Creative North Star: "The Well-Groomed Clipboard"**

mouStache looks like a tidy desk drawer built by someone who copies all day: a soft neutral grey ground (or near-black in dark mode), white cards with generous 22px corners, and exactly one voice, the brand ink blue. Everything else on screen is either real product evidence (screenshots, the film, a terminal, real tag chips) or quiet grey type. Colour beyond the ink belongs to the product's own tag system and appears only where a tag is being shown.

The world is the extension's own world, carried onto the web. Grounds, card tones, the tag hue family and the dark scheme follow the product UI, so a visitor's first look at the side panel feels like the page continued. The moustache mascot is the only character: it has no face and emotes by curling its two halves. The blue to indigo brand tile is the mark, and it is spent twice: on the logo and on the closing band.

Density is relaxed and editorial on the marketing surface: large tight-tracked headlines, 120 to 140px section breathing room, and one idea per section. Depth is soft and ambient, never structural; containers separate by tone and a hairline ring before they ever cast a shadow.

**Key Characteristics:**
- One accent, brand ink (#3458F0), split into a fill role and a text role per colour scheme.
- Neutral Apple-grade grounds: grey page, white cards, sunk grey stages; mirrored in dark mode.
- Tag hues are a closed set of seven product colours, used only on tag chips and the code they classify.
- Pill buttons, 9px tag chips, 14px screenshots, 22px frames and cells, 32px for the one closing band.
- Mona Sans at weight 700 with tight negative tracking for headlines; JetBrains Mono for every piece of code, command or keycap.
- Motion is reveal-and-swap on scroll with a blur-to-sharp ease; the mascot alone gets a spring.

## Colors

A cool neutral palette carrying one saturated ink blue, with a closed family of product tag hues held in reserve.

### Primary
- **Brand Ink** (brand-ink): the one accent. Fills primary buttons, text selection, and the mascot. In dark mode the fill stays the same blue so buttons keep their identity.
- **Lifted Ink** (accent-text-dark): the dark-scheme text role of the accent. Links-as-emphasis, the "S" in the wordmark, icons in facts and platform lists, step-state labels and the focus ring all use the accent text role, which equals Brand Ink in light mode and lifts to this periwinkle on dark grounds for legibility.
- **Ink Wash** (accent-soft / accent-soft-dark): a translucent accent tint for selected or soft-highlight states.

### Secondary
- **Brand Tile Gradient** (brand-tile-start to brand-tile-end, 135deg): the logo tile and the closing band. Nothing else.
- **Close Ink** (close-cta-ink): deep indigo text on the white button that sits on the gradient band.

### Tertiary
- **Tag Hues** (tag-code, tag-net, tag-err, tag-pr, tag-link, tag-data, tag-secret, each with a soft fill and a dark-scheme pair): Code indigo, Network teal, Errors red, Prompts violet, Links blue, Data amber, Secrets graphite. Light-mode text hues are darkened from the extension's values so the chip text holds contrast on its own soft fill.

### Neutral
- **Ground** (ground / ground-dark): page background.
- **Surface** (surface / surface-dark): cards, chips, keycaps, the alternating section bands (tags, get).
- **Sunk** (sunk / sunk-dark): recessed stages that hold screenshots.
- **Ink, Ink 2, Ink 3** (ink, ink-2, ink-3 and dark pairs): headings and primary text, secondary copy and ledes, muted copy (inactive steps, footer).
- **Hairline** (line / line-dark): borders, inset rings on cells, ghost-button outlines, the nav rule once scrolled.
- **Code Paper** (code-bg / code-bg-dark): code blocks inside specimen cells.
- **Terminal** (terminal, terminal-text, terminal-muted, terminal-prompt): a fixed-dark terminal in both schemes, with an ink-tinted prompt.

### Named Rules
**The One Voice Rule.** Brand ink is the only accent colour in the interface chrome. If a second colour appears outside a tag chip, the gradient band, or a real screenshot, it is wrong.

**The Fill/Text Split Rule.** Use the accent fill role for surfaces (button, selection, mascot) and the accent text role for type, icons and focus rings. Never set text in the fill blue on a dark ground.

**The Tags Are Data Rule.** Tag hues mean a classification. They appear on tag chips, on the icon tile of the thread chip, and on highlighted tokens inside the code they classify. Never as decoration.

**The Gradient Is the Mark Rule.** The blue to indigo gradient appears on the logo tile and on one closing band per page. It is never a button, a text fill, or a section background elsewhere.

## Typography

**Display Font:** Mona Sans (variable, 200 to 900, self-hosted; with system-ui, -apple-system, Segoe UI Variable)
**Body Font:** Mona Sans
**Label/Mono Font:** JetBrains Mono (variable, self-hosted; with ui-monospace, Consolas)

**Character:** A friendly grotesque set bold and tight for headlines, paired with a developer mono that makes every snippet look like the real thing. The marketing surface uses Mona Sans; the product UI keeps the system stack named in tokens.css.

### Hierarchy
- **Display** (700, clamp(2.6rem, 4.4vw, 4rem), 1.04, -0.04em): the hero headline only. Section climaxes (privacy, close) use the same treatment at clamp(2.2rem, 4 to 4.6vw, 3.6 to 4rem).
- **Headline** (700, clamp(2rem, 3.4vw, 3.1rem), 1.06, -0.04em): section headings, max 14em wide, balanced wrapping.
- **Title** (700, 28px, 1.15, -0.03em): step headings in the trail. Fact headings use 19px, 700, -0.02em with a 24px icon.
- **Lede** (400, 19px, 1.55): hero and problem follow-on copy in ink-2, max 30em. Section ledes run 18.5px, max 34em.
- **Body** (400, 17px, 1.6; 16px under 640px): running copy, step paragraphs at 17.5px max 26em.
- **Label** (600, 16px, 1, -0.01em): buttons; 14.5 to 15px for nav links, chips and footer.
- **Tag** (700, 15px, 1): tag chip text.
- **Mono** (JetBrains Mono, 14 to 15.5px): code blocks, the thread chip, the overwrite stack, terminal, keycaps at 0.82em weight 600.

### Named Rules
**The Tight Bold Rule.** Every h1 to h3 is weight 700 with negative tracking (-0.03 to -0.04em) and `text-wrap: balance`. No light or italic display weights.

**The Real Code Rule.** Anything a user would copy is set in JetBrains Mono, and keyboard shortcuts are always keycaps, never plain text like "Alt+Shift+V".

## Layout

A single centred wrap (1240px max, 24px side gutters, 16px under 640px). Sections stack vertically with 120 to 140px vertical padding on desktop and 88px on phones; alternating sections (tags, get) sit on the surface tone to band the page without rules.

Two-column grids are asymmetric fractions: hero 6/6, trail 4/8 with a sticky stage, privacy and get 5/7. Column gaps are 56 to 72px. A heading sits 56 to 64px above its content grid. Inner rhythm steps through 8, 10, 12, 14, 16, 24, 40px.

The specimen bento is a 6-column grid with 190px minimum rows and 16px gaps; the two widest tags take 3 columns and 2 rows, the rest 2 or 3 columns. It drops to 2 columns under 1000px and 1 column under 640px.

Breakpoints are 1000px (nav links hide, every grid goes single column, the pinned stage gives way to inline screenshots under each step) and 640px (type and padding step down, facts go single column).

### Named Rules
**The Visible-By-Default Rule.** Content renders fully without JavaScript. Scripts opt elements into reveal by adding a class; nothing is hidden in the stylesheet alone.

## Elevation & Depth

Ambient and soft. Depth comes first from tone (ground, surface, sunk) and a 1px hairline ring; shadows are long, low-opacity, ink-tinted blooms with a crisp 1 to 2px contact shadow underneath. They lift content that is evidence (the film, screenshots, the terminal) and floating chips. Dark mode keeps the same geometry with black at higher opacity.

### Shadow Vocabulary
- **Ambient** (`0 1px 2px rgba(28,32,68,0.06), 0 18px 44px -12px rgba(28,32,68,0.18)`): floating chips (thread chip, overwrite cards), ghost-button hover, inline screenshots.
- **Lifted** (`0 2px 4px rgba(28,32,68,0.06), 0 40px 80px -24px rgba(28,32,68,0.28)`): the film frame, stage screenshots, the terminal.
- **Pressable** (`inset 0 1px 0 rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.12), 0 10px 22px -12px rgba(0,0,0,0.45)`): primary buttons; deepens on hover with a 2px rise.
- **Band** (`0 30px 70px -36px rgba(0,0,0,0.55)`): the closing gradient band.

### Named Rules
**The Ring Before Shadow Rule.** Resting containers (specimen cells, ghost buttons, keycaps) separate with a 1px hairline ring or border, not a shadow. Shadows are earned by evidence and by things that float.

## Shapes

Soft, consistent rounding that scales with the object. Interactive controls are full pills (999px): buttons, film controls, copy button, the thread chip. Keycaps and small icon tiles take 8px. Tag chips take 9px, slightly squarer than pills so they read as labels, not buttons. Screenshots inside stages take 14px; frames and cells (film, stage, specimen cells, terminal, inline step-shot frames) take 22px. The single closing band takes 32px (26px on phones). The logo tile on the band is a 28px rounded square.

Borders are hairlines only (1px, or a 1.5px inset ring on ghost buttons). Frames clip their content with overflow hidden.

## Components

### Buttons
Confident pills with a tactile lift.
- **Shape:** full pill (999px), 52px tall (50px on phones), icon-led with a 10px gap and a 20px Phosphor bold icon.
- **Primary:** brand ink fill, white label, Pressable shadow.
- **Hover / Focus:** rises 2px with a deeper shadow over 0.25s on the house ease; presses to scale 0.98. Focus is a 2.5px accent-text outline at 3px offset.
- **Small:** 40px tall, 16px padding, 14.5px label, no shadow; used in the nav.
- **Ghost:** transparent with a 1.5px inset hairline ring and ink text; hover fills with surface and adds the Ambient shadow.
- **Light:** white fill with close-ink text and a deep indigo bloom; only on the gradient band.

### Keycaps
- **Style:** inline mono at 0.82em weight 600, surface fill, 1px hairline border, 8px radius, minimum 1.9em wide. Groups of keys are wrapped so they never break across lines.

### Chips
- **Tag chip:** 30px tall, 12px padding, 9px radius, tag soft fill with the matching tag hue text at 700. One per classification.
- **Thread chip:** a floating surface pill with the Ambient shadow carrying a 28px tag-tinted icon tile (8px radius) and one line of mono code, ellipsised. It docks at the hero's bottom edge as the thread into the next section.
- **Step state:** an accent-text label with a 19px icon (or a tag chip) that swaps in place as the trail advances.

### Cards / Containers
- **Specimen cell:** ground tone on the surface band, 22px radius, 1px inset hairline ring, 26px padding, 10px internal gap. Holds a tag chip, one sentence, and a code block (Code Paper, 14px radius, mono 14px) pinned to the bottom.
- **Stage:** a sticky column (top 92px, viewport-tall, max 820px) with a state row above a sunk 22px frame; screenshots sit centred at 28px inset with 14px radius and the Lifted shadow.
- **Film frame:** 16:9, 22px radius, clipped, Lifted shadow. Two 42px translucent dark pill controls (play/pause, sound) sit 14px from the bottom-right corner with a 10px backdrop blur.
- **Terminal:** fixed-dark in both schemes, 22px radius, Lifted shadow. A title bar with a hairline divider and a pill Copy button that turns a translucent green "Copied" for 2s; mono 15px at 1.85 line height with non-selectable ink-tinted prompts.

### Navigation
- **Style:** sticky 68px bar (60px on phones), ground at 82% with an 18px blur and 160% saturate. Wordmark at 19px 700 with the accent "S"; 15px ink-2 links that go to ink on hover; a small primary button at the end. A hairline appears under it only after the hero starts scrolling away. Links hide under 1000px.

### Facts List
- **Style:** a 2-column definition list (44px row gap, 40px column gap; single column on phones). Each term is 19px 700 with a 24px accent-text Phosphor icon; each description 16.5px ink-2.

### Closing Band
- **Style:** a full-wrap brand gradient block, 32px radius, centred stack with 28px gaps: the 120px logo tile (white hairline ring, indigo bloom), a display headline in white, and the light button.

### Footer
- **Style:** 14.5px ink-3 on the ground, a small wordmark, a status line, and the README link pushed to the far end.

### Mascot
The moustache alone, filled in brand ink. When the privacy section arrives, each half rotates 10deg outward around its centre on a spring (`cubic-bezier(0.34, 1.56, 0.64, 1)`, 0.6s). The overshoot is intentional character motion, the "happy" mood from the product's mascot set, and belongs to the mascot only.

### Motion
- **House ease:** `cubic-bezier(0.16, 1, 0.3, 1)` for every UI transition.
- **Reveals:** IntersectionObserver adds the in-state to headings, ledes, cells, facts and the close band: 18px rise plus 6px blur to sharp over 0.8 to 0.9s, staggered 70ms per sibling (max 6).
- **Pinned trail swap:** the step crossing the viewport's middle band activates; the stage cross-fades its screenshot (scale 1.03 and 6px blur to rest, 0.5 to 0.7s) and swaps the state label; inactive steps dim to ink-3.
- **Overwrite stack:** five copied lines replace each other every 620ms once in view, each leaving downward with blur, ending on the thread query.
- **Film:** muted autoplay only while 35% visible, never under reduced motion.
- **Reduced motion:** transitions collapse, reveals render visible, the stage is removed and every step shows its screenshot inline, and the overwrite stack shows as a static list with earlier copies struck through at 45% opacity above the survivor.

## Do's and Don'ts

### Do:
- **Do** fill with the accent fill role and write with the accent text role; in dark mode the button stays #3458F0 while text and icons lift to #8EA3FF.
- **Do** use the radius ladder exactly: pill controls, 8px keycaps, 9px tag chips, 14px screenshots, 22px frames and cells, 32px for the one closing band.
- **Do** show real product evidence (screenshots, the film, real commands) inside sunk or framed containers with the Lifted shadow.
- **Do** set every shortcut as keycaps and every snippet in JetBrains Mono.
- **Do** keep content visible by default and give every scroll effect a static reduced-motion layout.
- **Do** use Phosphor (regular for content, bold inside buttons and controls), self-hosted.

### Don't:
- **Don't** introduce a second accent colour in chrome; tag hues are for tags only.
- **Don't** use the brand gradient anywhere but the logo tile and the closing band.
- **Don't** set accent-fill blue as text on a dark ground; use the text role.
- **Don't** put shadows on resting cells or ghost controls; use the hairline ring.
- **Don't** put the mascot's spring easing on buttons, chips or reveals.
- **Don't** add eyebrow labels or kickers above headings; headings stand alone.
- **Don't** carry Mona Sans into the extension UI; product surfaces keep the system font stack.
