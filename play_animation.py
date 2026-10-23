import os
import sys
import cv2

def main():
    video_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lily_3d_botanical_animation.mp4")
    if not os.path.exists(video_path):
        print(f"Video file not found: {video_path}")
        sys.exit(1)

    cap = cv2.VideoCapture(video_path)
    window_name = "3D Botanical Lily Animation (Press Q to Exit)"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 540, 960)

    print("Playing animation on loop. Press 'Q' or 'Esc' in the window to stop.")

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        cv2.imshow(window_name, frame)
        key = cv2.waitKey(33) & 0xFF
        if key == ord('q') or key == 27:
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
