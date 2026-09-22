import React from 'react';
import { View, Text, StyleSheet, Animated, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export interface EverySenseLogoProps {
  size?: number;
  showText?: boolean;
  style?: ViewStyle;
  animated?: boolean;
}

export const EverySenseLogo: React.FC<EverySenseLogoProps> = ({ 
  size = 60, 
  showText = true, 
  style,
  animated = false
}) => {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (animated) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.04,
            duration: 2400,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 2400,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [animated, pulseAnim]);

  const ringSize = size;
  const innerSize = size * 0.78;

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        style={[
          styles.emblemOuter,
          { 
            width: ringSize, 
            height: ringSize, 
            borderRadius: ringSize / 2,
            transform: [{ scale: pulseAnim }]
          }
        ]}
      >
        <LinearGradient
          colors={['#1F2942', '#10172A', '#0B1020']}
          style={[styles.gradient, { width: ringSize, height: ringSize, borderRadius: ringSize / 2 }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* Subtle Royal Gold Outer Ring */}
          <View style={[styles.goldRing, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
            {/* Concentric Sensory Dots/Arch */}
            <View style={styles.sensoryArch}>
              <View style={[styles.dot, styles.dotLeft]} />
              <View style={[styles.dot, styles.dotTop]} />
              <View style={[styles.dot, styles.dotRight]} />
            </View>
            <Text style={[styles.monogram, { fontSize: size * 0.36 }]}>E</Text>
          </View>
        </LinearGradient>
      </Animated.View>
      
      {showText && (
        <View style={styles.textWrap}>
          <Text 
            style={[styles.brandText, { fontSize: Math.max(12, size * 0.20) }]}
            numberOfLines={1}
          >
            EVERYSENSE
          </Text>
        </View>
      )}
    </View>
  );
};

export const AccessAidLogo = EverySenseLogo;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#D6B36A',
    shadowColor: '#050811',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  gradient: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldRing: {
    borderWidth: 1,
    borderColor: 'rgba(214, 179, 106, 0.40)',
    backgroundColor: 'rgba(21, 29, 50, 0.70)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sensoryArch: {
    ...(StyleSheet.absoluteFill as object),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#D6B36A',
  },
  dotTop: {
    top: 5,
  },
  dotLeft: {
    left: 7,
    top: '46%',
  },
  dotRight: {
    right: 7,
    top: '46%',
  },
  monogram: {
    color: '#F7F3EA',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textWrap: {
    marginTop: 8,
    alignItems: 'center',
  },
  brandText: {
    color: '#F7F3EA',
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 3,
  },
});
