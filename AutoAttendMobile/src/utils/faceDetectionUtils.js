/**
 * faceDetectionUtils — react-native-vision-camera face detection (issue #117).
 *
 * Replaces the deprecated `expo-face-detector` (removed in Expo SDK 51+).
 * Provides a single reusable hook, `useAttendanceFaceVerify()`, that wires up
 * the front camera + on-device face detector and reports when exactly one
 * face is present in frame.
 *
 * ⚠️ Native module — requires a custom EAS *development client* build (NOT
 *    Expo Go). See eas.json `development` profile (`developmentClient: true`).
 *
 * Package note: the hook `useFaceDetector` is provided by
 * `react-native-vision-camera-face-detector` (the maintained successor to the
 * original `vision-camera-face-detector`); it is paired with
 * `react-native-vision-camera`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';

/**
 * Reusable face-verification hook for attendance / enrollment screens.
 *
 * @returns {{
 *   cameraRef: import('react').MutableRefObject<any>,
 *   device: object|undefined,
 *   frameProcessor: Function|undefined,
 *   faceDetected: boolean,
 *   faceData: object|null,
 *   hasPermission: boolean,
 *   requestPermission: () => Promise<boolean>,
 * }}
 */
export function useAttendanceFaceVerify() {
  const cameraRef = useRef(null);

  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  const [faceDetected, setFaceDetected] = useState(false);
  const [faceData, setFaceData] = useState(null);

  // Face detector options per spec: fast mode, no landmarks, full
  // classification (so eyesOpen / smiling probabilities are available).
  const { detectFaces } = useFaceDetector({
    performanceMode: 'fast',
    landmarkMode: 'none',
    classificationMode: 'all',
  });

  // Bridge worklet (camera thread) → JS thread. Guard against missing
  // Worklets runtime so importing this module never throws in environments
  // where the native module isn't present.
  const onFacesDetected = useCallback((faces) => {
    const single = Array.isArray(faces) && faces.length === 1;
    setFaceDetected(single);
    setFaceData(single ? faces[0] : null);
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      try {
        const faces = detectFaces(frame);
        // Marshal the result back to JS.
        Worklets.runOnJS(onFacesDetected)(faces);
      } catch (e) {
        // Frame processing must never crash the camera pipeline.
      }
    },
    [detectFaces, onFacesDetected]
  );

  // Reset detection state when the screen using the hook unmounts.
  useEffect(() => {
    return () => {
      setFaceDetected(false);
      setFaceData(null);
    };
  }, []);

  return {
    cameraRef,
    device,
    frameProcessor,
    faceDetected,
    faceData,
    hasPermission,
    requestPermission,
  };
}

export default { useAttendanceFaceVerify };
