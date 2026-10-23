# 🌸 3D Botanical Lily Animation with Python

A procedural 3D botanical animation of a bouquet of Oriental lilies, created with Python. The animation is designed in a vertical 9:16 format for Instagram Reels.

## ✨ Features

- 🌸 Procedurally constructed 3D lily flowers
- 🌿 Detailed petals, stems, leaves, stamens, and pistils
- 🎬 Animated flower construction and reveal
- 📱 Vertical 1080 × 1920 video format
- 🐍 Python-based animation generation

## 🛠️ Technologies

- Python
- NumPy
- OpenCV
- Additional Python libraries used by the script

## 🌐 Interactive Realtime Web App (Three.js / WebGL)

The project now includes an exact 1:1 realtime WebGL port that runs natively in any web browser at 60 FPS:
- **Zero video rendering wait**: Instant procedural generation directly on GPU.
- **Interactive Controls**: Play/pause, drag time scrubber (0s to 13s), switch between **Cinematic Auto-Camera** and **Free 3D Orbit** (drag to rotate, scroll to zoom).
- **Standalone & Offline**: Self-contained with bundled Three.js and OrbitControls.

### Launch the Web App:
Simply open `index.html` in your browser, or run:
```bash
python serve.py
```

## 📁 Project Structure

```text
lily-animation-python/
├── index.html                   # Interactive 3D WebGL application
├── lily_botanical.js            # Procedural 3D math, geometry & shader engine
├── style.css                    # Glassmorphic dark botanical styling
├── three.min.js                 # Standalone Three.js library
├── OrbitControls.js             # 3D interactive orbit controls
├── serve.py                     # One-click local web server
└── generate_lily_animation.py   # Python/FFmpeg MP4 video renderer
```

## 🚀 Getting Started

1. Download or clone this repository.
2. Install the Python dependencies required by the script.
3. Run the script:

```bash
python3 generate_lily_animation.py
```

**Note:** Check the imports at the top of the script and install any required dependencies before running it. The script may also require additional system tools.

## 🎥 Output

The script generates a vertical animated lily video suitable for showcasing in short-form content.

## 💗 About

Created as a Python animation project exploring procedural botanical modeling and cinematic visual storytelling.

If you found this project through my coding reels, feel free to explore the source code!

---

⭐ If you like this project, consider starring the repository.
