import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

interface ModernButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  hapticFeedback?: boolean;
  accessibilityLabel?: string;
}

export const ModernButton: React.FC<ModernButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  hapticFeedback = true,
  accessibilityLabel,
}) => {
  const handlePress = () => {
    if (hapticFeedback && !disabled && !loading) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  const getButtonStyle = (): StyleProp<ViewStyle> => {
    const baseStyle: StyleProp<ViewStyle>[] = [styles.button, styles[size]];
    
    if (disabled || loading) {
      baseStyle.push(styles.disabled);
    }
    
    return baseStyle;
  };

  const getTextStyle = (): StyleProp<TextStyle> => {
    const sizeKey = `${size}Text` as 'smallText' | 'mediumText' | 'largeText';
    const baseTextStyle: StyleProp<TextStyle>[] = [styles.text, styles[sizeKey]];
    
    if (variant === 'primary') {
      baseTextStyle.push(styles.primaryText);
    } else if (variant === 'outline') {
      baseTextStyle.push(styles.outlineText);
    } else if (variant === 'secondary') {
      baseTextStyle.push(styles.secondaryText);
    } else if (variant === 'danger') {
      baseTextStyle.push(styles.dangerText);
    }
    
    if (disabled || loading) {
      baseTextStyle.push(styles.disabledText);
    }
    
    return baseTextStyle;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <>
          <ActivityIndicator 
            size="small" 
            color={variant === 'primary' ? '#0B1020' : '#D6B36A'} 
          />
          <Text style={[getTextStyle(), textStyle, { marginLeft: 8 }]}>
            One moment...
          </Text>
        </>
      );
    }

    return (
      <>
        {icon && <>{icon}</>}
        <Text style={[getTextStyle(), textStyle, icon ? { marginLeft: 8 } : undefined]}>
          {title}
        </Text>
      </>
    );
  };

  if (variant === 'outline') {
    return (
      <TouchableOpacity
        style={[getButtonStyle(), styles.outline, style]}
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityLabel={accessibilityLabel || title}
        accessibilityRole="button"
      >
        {renderContent()}
      </TouchableOpacity>
    );
  }

  const gradientColors: [string, string] =
    variant === 'primary' ? ['#E5C98A', '#D6B36A'] :
    variant === 'secondary' ? ['#1B243B', '#151D32'] :
    variant === 'danger' ? ['#E06A6A', '#C85656'] :
    ['#E5C98A', '#D6B36A'];

  return (
    <LinearGradient
      colors={gradientColors}
      style={[getButtonStyle(), style]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <TouchableOpacity
        style={styles.touchable}
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityLabel={accessibilityLabel || title}
        accessibilityRole="button"
      >
        {renderContent()}
      </TouchableOpacity>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: '#050811',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  touchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  small: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 44, // 44px min touch target
  },
  medium: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 48,
  },
  large: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 54,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#D6B36A',
    shadowOpacity: 0,
    elevation: 0,
  },
  disabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  smallText: {
    fontSize: 14,
  },
  mediumText: {
    fontSize: 15,
  },
  largeText: {
    fontSize: 16,
  },
  primaryText: {
    color: '#0B1020', // High contrast royal text on champagne gold
    fontWeight: '700',
  },
  outlineText: {
    color: '#D6B36A',
  },
  secondaryText: {
    color: '#F7F3EA',
  },
  dangerText: {
    color: '#FFFFFF',
  },
  disabledText: {
    opacity: 0.8,
  },
});
