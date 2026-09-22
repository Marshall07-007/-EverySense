import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

interface ModernCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: 'default' | 'gradient' | 'elevated' | 'outlined';
  style?: ViewStyle;
  hapticFeedback?: boolean;
  accessibilityLabel?: string;
}

export const ModernCard: React.FC<ModernCardProps> = ({
  children,
  onPress,
  variant = 'default',
  style,
  hapticFeedback = true,
  accessibilityLabel,
}) => {
  const handlePress = () => {
    if (hapticFeedback) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  };

  const getCardStyle = () => {
    const baseStyle = [styles.card];
    
    switch (variant) {
      case 'gradient':
        return [...baseStyle, styles.gradientCard];
      case 'elevated':
        return [...baseStyle, styles.elevatedCard];
      case 'outlined':
        return [...baseStyle, styles.outlinedCard];
      default:
        return [...baseStyle, styles.defaultCard];
    }
  };

  if (variant === 'gradient') {
    return (
      <TouchableOpacity
        style={[getCardStyle(), style]}
        onPress={onPress ? handlePress : undefined}
        disabled={!onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={onPress ? 'button' : 'none'}
      >
        <LinearGradient
          colors={['#1B243B', '#151D32']}
          style={styles.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {children}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  if (onPress) {
    return (
      <TouchableOpacity
        style={[getCardStyle(), style]}
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[getCardStyle(), style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
  },
  defaultCard: {
    backgroundColor: '#151D32',
    borderColor: 'rgba(214, 179, 106, 0.16)',
    shadowColor: '#050811',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  gradientCard: {
    borderColor: 'rgba(214, 179, 106, 0.24)',
    shadowColor: '#050811',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  elevatedCard: {
    backgroundColor: '#151D32',
    borderColor: 'rgba(214, 179, 106, 0.20)',
    shadowColor: '#050811',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  outlinedCard: {
    backgroundColor: '#10172A',
    borderWidth: 1,
    borderColor: 'rgba(214, 179, 106, 0.28)',
    shadowOpacity: 0,
    elevation: 0,
  },
  gradient: {
    padding: 16,
  },
});
