import { SafeAreaView } from 'react-native-safe-area-context';
/**
 * EmergencyCardScreen.tsx
 *
 * A full-screen emergency profile card readable by first responders.
 * Accessible without unlocking — shows critical medical info at a glance.
 */

import React, { useRef } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../contexts/AppContext';

// ─── Row component ────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value, color = '#374151' }: {
  icon: string; label: string; value?: string; color?: string;
}) {
  if (!value?.trim()) return null;
  return (
    <View style={rowStyles.wrap}>
      <View style={[rowStyles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <View style={rowStyles.text}>
        <Text style={rowStyles.label}>{label}</Text>
        <Text style={rowStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  text: { flex: 1 },
  label: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  value: { fontSize: 16, fontWeight: '600', color: '#111827', lineHeight: 22 },
});

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={[sectionStyles.wrap, { borderLeftColor: color }]}>
      <Text style={[sectionStyles.title, { color }]}>{title}</Text>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 14, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EmergencyCardScreen() {
  const navigation = useNavigation();
  const { state }  = useApp();
  const user       = state.user;

  const hasInfo =
    user?.bloodGroup || user?.allergies || user?.medications ||
    user?.medicalConditions || user?.emergencyContactName;

  const callEmergency = () => {
    if (user?.emergencyContactPhone) {
      Alert.alert(
        `Call ${user.emergencyContactName || 'Emergency Contact'}?`,
        user.emergencyContactPhone,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call Now', onPress: () => Linking.openURL(`tel:${user.emergencyContactPhone}`) },
        ]
      );
    } else {
      Linking.openURL('tel:911');
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <LinearGradient colors={['#DC2626', '#EF4444']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🆘 Emergency Card</Text>
          <Text style={styles.headerSub}>Show this to first responders</Text>
        </View>
        <View style={{ width: 30 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Identity banner */}
        <LinearGradient colors={['#1F2937', '#374151']} style={styles.idBanner}>
          <View style={styles.idAvatar}>
            <Text style={styles.idAvatarText}>
              {(user?.name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.idInfo}>
            <Text style={styles.idName}>{user?.name || 'Unknown'}</Text>
            {user?.weight ? <Text style={styles.idMeta}>Weight: {user.weight}</Text> : null}
            {user?.height ? <Text style={styles.idMeta}>Height: {user.height}</Text> : null}
          </View>
          {user?.bloodGroup ? (
            <View style={styles.bloodBadge}>
              <Text style={styles.bloodType}>{user.bloodGroup}</Text>
              <Text style={styles.bloodLabel}>Blood Type</Text>
            </View>
          ) : null}
        </LinearGradient>

        {!hasInfo ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>⚠️</Text>
            <Text style={styles.emptyTitle}>No medical info saved</Text>
            <Text style={styles.emptySub}>
              Go to Profile → Medical Info to add your blood group, allergies, medications, and emergency contact.
            </Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Go to Profile</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Medical info */}
            <Section title="⚠️ Critical Medical Info" color="#DC2626">
              <InfoRow icon="water"        label="Blood Group"         value={user?.bloodGroup}        color="#DC2626" />
              <InfoRow icon="alert-circle" label="Allergies"           value={user?.allergies}         color="#F59E0B" />
              <InfoRow icon="medkit"       label="Current Medications" value={user?.medications}       color="#7C3AED" />
              <InfoRow icon="fitness"      label="Medical Conditions"  value={user?.medicalConditions} color="#2563EB" />
            </Section>

            {/* Emergency contact */}
            {user?.emergencyContactName ? (
              <Section title="📞 Emergency Contact" color="#059669">
                <InfoRow icon="person"  label="Name"         value={user.emergencyContactName}         color="#059669" />
                <InfoRow icon="people"  label="Relationship" value={user.emergencyContactRelationship} color="#059669" />
                <InfoRow icon="call"    label="Phone"        value={user.emergencyContactPhone}        color="#059669" />
              </Section>
            ) : null}
          </>
        )}

        {/* Call button */}
        <TouchableOpacity style={styles.callBtn} onPress={callEmergency}>
          <LinearGradient colors={['#DC2626', '#EF4444']} style={styles.callGrad}>
            <Ionicons name="call" size={22} color="#fff" />
            <Text style={styles.callText}>
              {user?.emergencyContactPhone
                ? `Call ${user.emergencyContactName || 'Emergency Contact'}`
                : 'Call 911'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Footer note */}
        <Text style={styles.footer}>
          This card uses information from your EverySense profile.{'\n'}
          Keep your profile updated to ensure accuracy.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { padding: 4, width: 30 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub:   { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },

  scroll: { padding: 16 },

  idBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18, marginBottom: 16,
  },
  idAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  idAvatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  idInfo: { flex: 1 },
  idName: { color: '#fff', fontSize: 20, fontWeight: '800' },
  idMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  bloodBadge: {
    backgroundColor: '#DC2626', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  bloodType:  { color: '#fff', fontSize: 22, fontWeight: '900' },
  bloodLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '600', marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151' },
  emptySub:   { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
  emptyBtn:   { backgroundColor: '#DC2626', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  callBtn:  { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  callGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  callText: { color: '#fff', fontSize: 17, fontWeight: '800' },

  footer: { textAlign: 'center', color: '#9CA3AF', fontSize: 12, lineHeight: 18, marginTop: 20, paddingHorizontal: 20 },
});
