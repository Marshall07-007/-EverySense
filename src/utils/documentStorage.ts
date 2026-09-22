/**
 * documentStorage.ts
 * Lightweight local storage for documents scanned via Smart Scan.
 * Uses on-device AsyncStorage and integrates with EverySense activityLogger.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SmartScanResult } from '../types';
import { logActivity } from './activityLogger';

export interface SavedDocumentRecord {
  id: string;
  savedAt: string;
  document: SmartScanResult;
}

const STORAGE_KEY = '@everysense_saved_documents';
const MAX_SAVED = 100;

/**
 * Generate a unique document fingerprint to detect duplicates
 */
function getDocumentFingerprint(doc: SmartScanResult): string {
  const t = (doc.title || '').trim().toLowerCase();
  const a = (doc.amount || '').trim().toLowerCase();
  const d = (doc.dueDate || '').trim().toLowerCase();
  const type = (doc.documentType || '').trim().toLowerCase();
  return `${type}_${t}_${a}_${d}`;
}

/**
 * Get all saved documents sorted by most recent
 */
export async function getSavedDocuments(): Promise<SavedDocumentRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: SavedDocumentRecord[] = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[DocumentStorage] Failed to load saved documents:', err);
    return [];
  }
}

/**
 * Check if a document is already saved
 */
export async function isDocumentSaved(doc: SmartScanResult): Promise<boolean> {
  try {
    const existing = await getSavedDocuments();
    const fp = getDocumentFingerprint(doc);
    return existing.some(item => getDocumentFingerprint(item.document) === fp);
  } catch {
    return false;
  }
}

/**
 * Save a scanned document to local storage
 */
export async function saveDocument(
  doc: SmartScanResult,
): Promise<{ success: boolean; id: string; alreadySaved: boolean }> {
  try {
    const existing = await getSavedDocuments();
    const fp = getDocumentFingerprint(doc);
    const existingIndex = existing.findIndex(item => getDocumentFingerprint(item.document) === fp);

    if (existingIndex !== -1) {
      // Already saved - return existing id
      return { success: true, id: existing[existingIndex].id, alreadySaved: true };
    }

    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newRecord: SavedDocumentRecord = {
      id,
      savedAt: new Date().toISOString(),
      document: doc,
    };

    const updated = [newRecord, ...existing].slice(0, MAX_SAVED);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    // Log user activity
    const label = doc.title && doc.title !== 'Not detected' ? doc.title : doc.documentType;
    await logActivity('ocr', `Saved ${doc.documentType}: ${label}`).catch(() => {});

    return { success: true, id, alreadySaved: false };
  } catch (err) {
    console.error('[DocumentStorage] Failed to save document:', err);
    return { success: false, id: '', alreadySaved: false };
  }
}

/**
 * Delete a saved document by ID
 */
export async function deleteSavedDocument(id: string): Promise<boolean> {
  try {
    const existing = await getSavedDocuments();
    const filtered = existing.filter(d => d.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.error('[DocumentStorage] Failed to delete document:', err);
    return false;
  }
}
