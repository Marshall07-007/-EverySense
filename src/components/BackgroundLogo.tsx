import React from 'react';
import { View, StyleSheet } from 'react-native';
import { EverySenseLogo } from './EverySenseLogo';

export const BackgroundLogo = ({ opacity = 0.06, size = 320 }: { opacity?: number; size?: number }) => {
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={[styles.logoWrap, { opacity }]}> 
        <EverySenseLogo size={size} showText={true} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    transform: [{ translateY: -40 }],
  },
});
