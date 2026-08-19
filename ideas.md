# Phase 0 LLM Load Tester — Design Directions

## Three possible approaches

### 1. Instrument Panel
**Very Brief Intro:** A warm, high-contrast operations console inspired by lab instruments and serious engineering tools. It prioritizes scanability, visible capacity, and a sense of controlled live activity.

**Probability:** 0.037

### 2. Quiet Lab Notebook
**Very Brief Intro:** A calm editorial workspace that treats test runs as experiments, with generous whitespace, subtle paper texture, and careful data annotations. It feels like a research instrument rather than an infrastructure dashboard.

**Probability:** 0.082

### 3. Signal Grid
**Very Brief Intro:** A dense but orderly control room with crisp technical type, dark structural panels, and luminous state signals. It makes concurrent users feel like independent live channels moving through a shared system.

**Probability:** 0.054

## Chosen approach: Instrument Panel

### Design Movement
Modern industrial interface design, informed by precision measuring instruments and early technical control systems rather than generic “cyber” dashboards.

### Core Principles
1. Every visual unit must answer an operational question quickly: what is running, who is waiting, and where capacity is going.
2. Warm neutral surfaces create focus; signal colors are reserved for status, performance, and safety states.
3. Dense information is organized as an instrument cluster with a persistent setup rail, live central field, and evidence panel rather than a centered card grid.
4. Controls should feel deliberate and mechanically trustworthy: compact labels, visible values, and unambiguous run/stop states.

### Color Philosophy
The interface uses graphite and ink as its structural base, parchment-toned panels for readable configuration surfaces, and a single ownable safety-orange signal as the action and active-run color. Teal means healthy throughput, amber means waiting, and red is reserved for errors or stop actions. The palette evokes calibrated equipment rather than neon futurism.

### Layout Paradigm
An asymmetric three-zone bench: a fixed left configuration rail, a wide central live-run canvas, and a narrow right evidence strip for per-user streams. On smaller screens, the rail becomes a stacked top control section while test channels remain the main focus.

### Signature Elements
1. A segmented capacity meter showing active slots, queue depth, and completed users.
2. A vertical “run tape” with timestamped test events and concise operational messages.
3. Per-user stream cards distinguished by small channel markers, elapsed timers, and a fine progress trace.

### Interaction Philosophy
Inputs update a transparent test plan before any request begins. Launching a run turns the controls into a locked readout while a clear stop control remains available. Each virtual user is inspectable without interrupting the overall test.

### Animation
Use short opacity and transform transitions under 220ms for controls and panels. During a run, the capacity meter advances in discrete steps and active user indicators pulse very subtly. Text output should appear immediately without theatrical typing animation. Respect reduced-motion preferences.

### Typography System
Use **Space Grotesk** for headings, labels, and primary metrics because its geometric detail reads as engineered without looking sterile. Use **IBM Plex Mono** for endpoint text, token counts, timestamps, and stream output. Large metrics use Space Grotesk semibold; all technical values are tabular where possible.

### Brand Essence
**A hands-on load lab for builders who need to see how a local LLM behaves under real concurrent demand.**

**Personality:** measured, lucid, dependable.

### Brand Voice
Headlines are concise and operational; CTAs describe the action and expected outcome instead of making promises. Microcopy should communicate limits openly.

Example lines: “Run five independent conversations against one model.”

Example lines: “Queue depth is a result, not a failure.”

### Wordmark & Logo
The mark is a bold orange calibration ring interrupted by three offset tick marks, suggesting concurrent request lanes entering one shared model. The wordmark uses tightly spaced Space Grotesk with a single orange baseline rule under “LOAD.”

### Signature Brand Color
**Calibration Orange — `#F05D23`**

## Style Decisions

- Parchment-toned instrument faceplates are reserved for the configuration rail and compact readout plates; graphite remains the outer chassis, live stream canvas, and evidence frame.
- The central observation field must foreground a segmented request-lane capacity meter, queue depth, active work, and completed work before explanatory copy.
- The right-hand run tape maintains technical density in idle state through timestamped slots, channel markers, and compact event counters.
- The wordmark uses a visible Calibration Orange baseline beneath `LOAD`, reinforcing that the calibration-ring icon and name form one proprietary unit.
