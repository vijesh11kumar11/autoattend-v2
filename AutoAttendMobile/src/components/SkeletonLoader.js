/**
 * SkeletonLoader — shimmer placeholder for loading states.
 * Uses react-native-reanimated (already installed) for the shimmer animation.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

function ShimmerBlock({ width, height = 14, borderRadius = 6, style }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: '#e2e8f0',
        },
        style,
        animStyle,
      ]}
    />
  );
}

/**
 * CardSkeleton — mimics a dashboard card while loading.
 */
export function CardSkeleton({ count = 3 }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.card}>
          <ShimmerBlock width={120} height={16} />
          <ShimmerBlock width="80%" height={12} style={{ marginTop: 10 }} />
          <ShimmerBlock width="60%" height={12} style={{ marginTop: 6 }} />
          <ShimmerBlock width="100%" height={8} borderRadius={4} style={{ marginTop: 12 }} />
        </View>
      ))}
    </View>
  );
}

/**
 * ListSkeleton — mimics a list of rows while loading.
 */
export function ListSkeleton({ count = 5 }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <ShimmerBlock width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
            <ShimmerBlock width="70%" height={14} />
            <ShimmerBlock width="40%" height={10} />
          </View>
          <ShimmerBlock width={36} height={20} borderRadius={8} />
        </View>
      ))}
    </View>
  );
}

/**
 * StatsSkeleton — mimics horizontal stat cards.
 */
export function StatsSkeleton({ count = 4 }) {
  return (
    <View style={styles.statsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.statCard}>
          <ShimmerBlock width={24} height={24} borderRadius={12} />
          <ShimmerBlock width={50} height={20} style={{ marginTop: 6 }} />
          <ShimmerBlock width={40} height={10} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  );
}

export { ShimmerBlock };

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  statCard: {
    width: 100,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
});
