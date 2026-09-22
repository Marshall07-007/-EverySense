/**
 * ChatModal.tsx
 * Modern messenger-style chat — text + image sharing.
 * WhatsApp/iMessage-inspired UI with date separators and image preview.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  getMessages,
  sendMessage,
  subscribeToMessages,
  type Connection,
  type Message,
} from '../../services/socialService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDateLabel = (iso: string) => {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diff > 365 ? 'numeric' : undefined });
};

const isSameDay = (a: string, b: string) => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

const avatarInitial = (name?: string) => (name || '?').charAt(0).toUpperCase();

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  connection: Connection;
  onClose: () => void;
  userId: string;
  ui: any;
  scale: (n: number) => number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatModal({ visible, connection, onClose, userId, ui, scale }: Props) {
  const isDark = ui.bg === '#0d1117' || ui.bg?.startsWith('#0') || ui.bg?.startsWith('#1');

  const [messages,      setMessages]      = useState<Message[]>([]);
  const [draft,         setDraft]         = useState('');
  const [loading,       setLoading]       = useState(true);
  const [sending,       setSending]       = useState(false);
  const [pendingImage,  setPendingImage]  = useState<string | null>(null); // local URI preview
  const [uploadingImg,  setUploadingImg]  = useState(false);

  const flatRef    = useRef<FlatList>(null);
  const inputRef   = useRef<TextInput>(null);
  const other      = connection.other_profile;

  const bg       = ui.bg;
  const cardBg   = ui.cardBg;
  const border   = ui.divider;
  const textCol  = ui.text;
  const mutedCol = ui.subtext;
  const accent   = ui.accent;

  // ── Load + realtime ───────────────────────────────────────────────────────

  const loadMessages = useCallback(async () => {
    try {
      const data = await getMessages(connection.id);
      setMessages(data);
    } catch (e) {
      console.error('ChatModal load error', e);
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    if (visible) { setLoading(true); loadMessages(); }
    else { setMessages([]); setDraft(''); setPendingImage(null); }
  }, [visible, loadMessages]);

  useEffect(() => {
    if (!visible) return;
    const ch = subscribeToMessages(connection.id, (msg: Message) => {
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
    });
    return () => { ch.unsubscribe(); };
  }, [visible, connection.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages]);

  // ── Image picker ──────────────────────────────────────────────────────────

  const pickImage = useCallback(() => {
    Alert.alert('Send Image', 'Choose source', [
      {
        text: 'Camera',
        onPress: async () => {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) { Alert.alert('Permission needed', 'Camera access required.'); return; }
          const r = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
          if (!r.canceled) setPendingImage(r.assets[0].uri);
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) { Alert.alert('Permission needed', 'Gallery access required.'); return; }
          const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true });
          if (!r.canceled) setPendingImage(r.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const uploadImage = useCallback(async (uri: string): Promise<string> => {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 800 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!manipulated.base64) throw new Error('Failed to process image');

    const binaryString = atob(manipulated.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const fileName = `${userId}/${connection.id}_${Date.now()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from('chat-images')
      .upload(fileName, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploadErr) throw uploadErr;

    const { data: { publicUrl } } = supabase.storage.from('chat-images').getPublicUrl(fileName);
    return publicUrl;
  }, [userId, connection.id]);

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && !pendingImage) return;
    if (sending || uploadingImg) return;

    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    let imageUrl: string | null = null;
    if (pendingImage) {
      setUploadingImg(true);
      try {
        imageUrl = await uploadImage(pendingImage);
      } catch (e) {
        Alert.alert('Upload failed', 'Could not upload image. Please try again.');
        setSending(false);
        setUploadingImg(false);
        return;
      } finally {
        setUploadingImg(false);
      }
    }

    const content = text || (imageUrl ? '📷 Photo' : '');
    setDraft('');
    setPendingImage(null);

    try {
      await sendMessage(connection.id, userId, content, imageUrl);
    } catch (e) {
      Alert.alert('Error', 'Could not send message. Please try again.');
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, pendingImage, sending, uploadingImg, uploadImage, connection.id, userId]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const isMine = (msg: Message) => msg.sender_id === userId;

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const mine     = isMine(item);
    const prev     = messages[index - 1];
    const next     = messages[index + 1];
    const showDate = !prev || !isSameDay(prev.created_at, item.created_at);
    const isFirst  = !prev || prev.sender_id !== item.sender_id;
    const isLast   = !next || next.sender_id !== item.sender_id;
    const showAvatar = !mine && isLast;

    // Bubble shape
    const br = 18;
    const bubbleRadius = mine
      ? { borderTopLeftRadius: br, borderTopRightRadius: isFirst ? br : 4, borderBottomLeftRadius: br, borderBottomRightRadius: isLast ? 4 : 4 }
      : { borderTopLeftRadius: isFirst ? br : 4, borderTopRightRadius: br, borderBottomLeftRadius: isLast ? 4 : 4, borderBottomRightRadius: br };

    return (
      <View>
        {/* Date separator */}
        {showDate && (
          <View style={s.dateSep}>
            <View style={[s.dateLine, { backgroundColor: border }]} />
            <Text style={[s.dateText, { color: mutedCol, backgroundColor: bg }]}>
              {formatDateLabel(item.created_at)}
            </Text>
            <View style={[s.dateLine, { backgroundColor: border }]} />
          </View>
        )}

        <View style={[s.msgRow, mine ? s.msgRowMine : s.msgRowOther, { marginTop: isFirst ? 6 : 2 }]}>
          {/* Other avatar slot */}
          {!mine && (
            <View style={s.avatarSlot}>
              {showAvatar ? (
                other?.profile_picture
                  ? <Image source={{ uri: other.profile_picture }} style={s.avatar} />
                  : (
                    <LinearGradient colors={['#7C3AED', '#A855F7']} style={s.avatar}>
                      <Text style={s.avatarText}>{avatarInitial(other?.display_name)}</Text>
                    </LinearGradient>
                  )
              ) : <View style={s.avatar} />}
            </View>
          )}

          {/* Bubble */}
          <View style={[
            s.bubble,
            bubbleRadius,
            mine
              ? { backgroundColor: accent || '#7C3AED' }
              : { backgroundColor: cardBg, borderColor: border, borderWidth: 1 },
          ]}>
            {/* Image */}
            {item.image_url ? (
              <Image
                source={{ uri: item.image_url }}
                style={s.bubbleImage}
                resizeMode="cover"
              />
            ) : null}

            {/* Text (hide if it's just the auto "📷 Photo" placeholder and there IS an image) */}
            {item.content && !(item.image_url && item.content === '📷 Photo') ? (
              <Text style={[s.bubbleText, { color: mine ? '#fff' : textCol }]}>
                {item.content}
              </Text>
            ) : null}

            {/* Time */}
            <Text style={[s.bubbleTime, { color: mine ? 'rgba(255,255,255,0.65)' : mutedCol }]}>
              {formatTime(item.created_at)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[s.safe, { backgroundColor: bg }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          {/* ── Header ── */}
          <View style={[s.header, { backgroundColor: cardBg, borderBottomColor: border }]}>
            <TouchableOpacity style={s.backBtn} onPress={onClose} accessibilityLabel="Close chat">
              <Ionicons name="arrow-back" size={22} color={textCol} />
            </TouchableOpacity>

            <TouchableOpacity style={s.headerCenter} activeOpacity={0.8}>
              <View style={s.headerAvatarWrap}>
                {other?.profile_picture
                  ? <Image source={{ uri: other.profile_picture }} style={s.headerAvatar} />
                  : (
                    <LinearGradient colors={['#7C3AED', '#A855F7']} style={s.headerAvatar}>
                      <Text style={s.headerAvatarText}>{avatarInitial(other?.display_name)}</Text>
                    </LinearGradient>
                  )}
                <View style={s.onlineDot} />
              </View>
              <View>
                <Text style={[s.headerName, { color: textCol }]} numberOfLines={1}>
                  {other?.display_name ?? 'Connection'}
                </Text>
                <Text style={[s.headerSub, { color: mutedCol }]}>Connected</Text>
              </View>
            </TouchableOpacity>

            <View style={{ width: 40 }} />
          </View>

          {/* ── Messages ── */}
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={accent} />
            </View>
          ) : (
            <FlatList
              ref={flatRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={renderMessage}
              contentContainerStyle={[s.list, { backgroundColor: bg }]}
              style={{ backgroundColor: bg }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyEmoji}>👋</Text>
                  <Text style={[s.emptyTitle, { color: textCol }]}>
                    Say hi to {other?.display_name ?? 'your connection'}!
                  </Text>
                  <Text style={[s.emptySub, { color: mutedCol }]}>
                    You're connected — start the conversation or send a photo.
                  </Text>
                </View>
              }
            />
          )}

          {/* ── Pending image preview ── */}
          {pendingImage && (
            <View style={[s.pendingWrap, { backgroundColor: cardBg, borderTopColor: border }]}>
              <Image source={{ uri: pendingImage }} style={s.pendingImg} resizeMode="cover" />
              <TouchableOpacity style={s.pendingRemove} onPress={() => setPendingImage(null)}>
                <View style={s.pendingRemoveCircle}>
                  <Ionicons name="close" size={14} color="#fff" />
                </View>
              </TouchableOpacity>
              {uploadingImg && (
                <View style={s.pendingUploadOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
            </View>
          )}

          {/* ── Input bar ── */}
          <View style={[s.inputBar, { backgroundColor: cardBg, borderTopColor: border }]}>
            {/* Image button */}
            <TouchableOpacity
              style={[s.inputIconBtn, { backgroundColor: isDark ? '#ffffff12' : '#00000008' }]}
              onPress={pickImage}
              disabled={sending}
              accessibilityLabel="Send image"
            >
              <Ionicons name="image-outline" size={22} color={accent} />
            </TouchableOpacity>

            {/* Text input */}
            <TextInput
              ref={inputRef}
              style={[s.input, { backgroundColor: isDark ? '#ffffff0e' : '#f4f4f5', color: textCol, borderColor: border }]}
              placeholder={`Message ${other?.display_name ?? ''}…`}
              placeholderTextColor={mutedCol}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={500}
              accessibilityLabel="Message input"
            />

            {/* Send button */}
            <TouchableOpacity
              style={[s.sendBtn, { opacity: (draft.trim() || pendingImage) && !sending ? 1 : 0.4 }]}
              onPress={handleSend}
              disabled={(!draft.trim() && !pendingImage) || sending}
              accessibilityLabel="Send message"
            >
              <LinearGradient colors={['#7C3AED', '#A855F7']} style={s.sendGrad}>
                {sending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="arrow-up" size={20} color="#fff" />}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn:         { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatarWrap:{ position: 'relative' },
  headerAvatar:    { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  headerAvatarText:{ color: '#fff', fontWeight: '800', fontSize: 16 },
  onlineDot:       { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#fff' },
  headerName:      { fontSize: 16, fontWeight: '700' },
  headerSub:       { fontSize: 12, marginTop: 1 },

  // List
  list: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },

  // Date separator
  dateSep:  { flexDirection: 'row', alignItems: 'center', marginVertical: 12, gap: 8 },
  dateLine: { flex: 1, height: 1 },
  dateText: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8 },

  // Message rows
  msgRow:      { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 1 },
  msgRowMine:  { flexDirection: 'row-reverse' },
  msgRowOther: {},
  avatarSlot:  { width: 34, marginRight: 6, marginBottom: 2 },
  avatar:      { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarText:  { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Bubble
  bubble:      { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 8, gap: 4, overflow: 'hidden' },
  bubbleImage: { width: 200, height: 160, borderRadius: 10, marginBottom: 4 },
  bubbleText:  { fontSize: 15, lineHeight: 21 },
  bubbleTime:  { fontSize: 10, alignSelf: 'flex-end' },

  // Empty
  empty:      { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub:   { fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // Pending image preview bar
  pendingWrap:         { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1 },
  pendingImg:          { width: 60, height: 60, borderRadius: 10 },
  pendingRemove:       { position: 'absolute', top: 6, left: 54 },
  pendingRemoveCircle: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  pendingUploadOverlay:{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', borderRadius: 10 },

  // Input bar
  inputBar:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: 1 },
  inputIconBtn:{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input:       { flex: 1, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 6, maxHeight: 120, fontSize: 15, lineHeight: 22 },
  sendBtn:     { width: 40, height: 40 },
  sendGrad:    { flex: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
