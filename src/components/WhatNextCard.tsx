import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SmartScanResult, WhatNextAction, WhatNextActionType } from '../types';
import { AppTheme } from '../../constants/theme';
import { parseDateTime, toLocalISOString } from '../utils/dateTimeParser';

interface Props {
  result: SmartScanResult;
  theme: AppTheme;
  onAction: (action: WhatNextAction) => void;
  isSaved?: boolean;
}

type DocumentCategory = 'BILL' | 'COLLEGE' | 'MEDICAL' | 'RECEIPT' | 'GENERIC';

/**
 * Safely calculate reminder date for 1 day prior to due date at 9:00 AM
 */
export function calculateSuggestedReminderDate(
  dueDateStr: string,
  now: Date = new Date(),
): { reminderDate: Date; formattedLabel: string; safeIsoString: string } | null {
  if (!dueDateStr || dueDateStr === 'Not detected') return null;

  const clean = dueDateStr.trim();
  let parsed: Date | null = null;

  // 1. Try parseDateTime with reference date first (respects current year for phrases like "September 28")
  const nlResult = parseDateTime(clean, now);
  if (nlResult && nlResult.date && !isNaN(nlResult.date.getTime())) {
    parsed = new Date(nlResult.date);
  }

  // 2. Try Date.parse fallback (for ISO or full dates like "September 28, 2026")
  if (!parsed) {
    const ts = Date.parse(clean);
    if (!isNaN(ts)) {
      const d = new Date(ts);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) {
        parsed = d;
      }
    }
  }

  // 3. Try removing ordinal suffixes ("28th" -> "28")
  if (!parsed) {
    const stripped = clean.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
    const ts2 = Date.parse(stripped);
    if (!isNaN(ts2)) {
      const d = new Date(ts2);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) {
        parsed = d;
      }
    }
  }

  if (!parsed) return null;

  // Calculate 1 day before at 9:00 AM
  const reminderDate = new Date(parsed);
  reminderDate.setDate(reminderDate.getDate() - 1);
  reminderDate.setHours(9, 0, 0, 0);

  // If reminderDate is in the past, handle gracefully
  if (reminderDate.getTime() <= now.getTime()) {
    if (parsed.getTime() > now.getTime()) {
      // Due date is in future, set reminder for 2 hours from now
      reminderDate.setTime(now.getTime() + 2 * 60 * 60 * 1000);
    } else {
      // Due date is in the past, do not invent a past reminder
      return null;
    }
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = monthNames[reminderDate.getMonth()];
  const day = reminderDate.getDate();
  const formattedLabel = `${month} ${day}`;
  const safeIsoString = toLocalISOString(reminderDate);

  return {
    reminderDate,
    formattedLabel,
    safeIsoString,
  };
}

/**
 * Categorize document based on documentType and extracted text
 */
function getDocumentCategory(result: SmartScanResult): DocumentCategory {
  const combined = `${result.documentType} ${result.title} ${result.importantInfo} ${result.explanation}`.toLowerCase();

  // Medical / Health detection
  const medicalRegex = /\b(hospital|clinic|doctor|physician|prescription|medication|rx|patient|diagnosis|dosage|therapy|lab test|blood test|medical|pharmacy)\b/i;
  if (medicalRegex.test(combined)) {
    return 'MEDICAL';
  }

  // Bill detection
  if (result.documentType === 'Electricity bill' || result.documentType === 'Water bill') {
    return 'BILL';
  }
  const billRegex = /\b(bill|utility|electricity|water|gas|telecom|broadband|due date|amount due|tneb|bescom)\b/i;
  if (billRegex.test(combined) && result.dueDate !== 'Not detected') {
    return 'BILL';
  }

  // College / Education notice detection
  if (result.documentType === 'College/education document') {
    return 'COLLEGE';
  }
  const collegeRegex = /\b(college|university|school|exam|examination|hall ticket|admission|semester|notice|circular|assignment|tuition|scholarship)\b/i;
  if (collegeRegex.test(combined)) {
    return 'COLLEGE';
  }

  // Receipt detection
  const receiptRegex = /\b(receipt|store|mart|supermarket|restaurant|cafe|retail|cash memo|counter|pos|purchase)\b/i;
  if (result.documentType === 'Invoice/receipt' || receiptRegex.test(combined)) {
    // If it has a future due date, treat as bill/invoice
    if (result.dueDate && result.dueDate !== 'Not detected') {
      return 'BILL';
    }
    return 'RECEIPT';
  }

  return 'GENERIC';
}

export const WhatNextCard: React.FC<Props> = ({
  result,
  theme,
  onAction,
  isSaved = false,
}) => {
  const [localSaved, setLocalSaved] = useState(isSaved);

  const category = useMemo(() => getDocumentCategory(result), [result]);
  const reminderSuggestion = useMemo(
    () => calculateSuggestedReminderDate(result.dueDate),
    [result.dueDate],
  );

  // Generate Document-Aware Actions and Prioritized Action Plan
  const { summaryBanner, steps, actions } = useMemo(() => {
    const docTitle = result.title !== 'Not detected' ? result.title : result.documentType;
    const hasDueDate = Boolean(result.dueDate && result.dueDate !== 'Not detected');
    const hasAmount = Boolean(result.amount && result.amount !== 'Not detected');
    const suggestedDateLabel = reminderSuggestion?.formattedLabel;

    let banner = 'Here’s what you can do with this information.';
    const stepList: string[] = [];
    const actionList: WhatNextAction[] = [];

    switch (category) {
      case 'BILL': {
        banner = `Your ${docTitle}${hasAmount ? ` is ${result.amount}` : ''}${hasDueDate ? ` and is due ${result.dueDate}` : ''}.`;
        
        stepList.push(hasDueDate ? `Pay before ${result.dueDate}` : 'Consider paying before the due date');
        if (suggestedDateLabel) {
          stepList.push(`Set a reminder for ${suggestedDateLabel}`);
        } else {
          stepList.push('Set a payment reminder');
        }
        stepList.push('Review charges to confirm accuracy');
        stepList.push('Keep this bill for future reference');

        // 1. Reminder (Prominent)
        actionList.push({
          id: 'action_bill_reminder',
          type: 'CREATE_REMINDER',
          title: suggestedDateLabel ? `Set reminder for ${suggestedDateLabel}` : 'Set payment reminder',
          description: 'Remind me before the bill is due.',
          icon: 'alarm-outline',
          isPrimary: true,
          metadata: {
            suggestedDateIso: reminderSuggestion?.safeIsoString,
            prefillTitle: `Pay ${docTitle}`,
          },
        });

        // 2. Explain charges
        actionList.push({
          id: 'action_bill_explain',
          type: 'EXPLAIN',
          title: 'Explain charges',
          description: 'Understand what this document includes.',
          icon: 'help-circle-outline',
        });

        // 3. Chatbot
        actionList.push({
          id: 'action_bill_chat',
          type: 'CHAT',
          title: 'Ask EverySense',
          description: 'Ask questions about this bill.',
          icon: 'chatbubble-ellipses-outline',
        });

        // 4. Save
        actionList.push({
          id: 'action_bill_save',
          type: 'SAVE',
          title: localSaved ? 'Saved to library ✓' : 'Save bill',
          description: 'Keep this document available for future reference.',
          icon: localSaved ? 'bookmark' : 'bookmark-outline',
        });
        break;
      }

      case 'COLLEGE': {
        banner = `This appears to be an academic document${hasDueDate ? ` with a deadline of ${result.dueDate}` : ''}.`;

        stepList.push('Review requirements and submission criteria');
        stepList.push(hasDueDate ? `Submit before deadline (${result.dueDate})` : 'Mark critical dates on calendar');
        if (suggestedDateLabel) {
          stepList.push(`Set a deadline reminder for ${suggestedDateLabel}`);
        } else {
          stepList.push('Set a deadline reminder');
        }
        stepList.push('Save document for records');

        // 1. Deadline Reminder
        actionList.push({
          id: 'action_college_reminder',
          type: 'CREATE_REMINDER',
          title: suggestedDateLabel ? `Set deadline reminder for ${suggestedDateLabel}` : 'Set deadline reminder',
          description: 'Remind me before the submission deadline.',
          icon: 'alarm-outline',
          isPrimary: hasDueDate,
          metadata: {
            suggestedDateIso: reminderSuggestion?.safeIsoString,
            prefillTitle: `Deadline: ${docTitle}`,
          },
        });

        // 2. Explain requirements
        actionList.push({
          id: 'action_college_explain',
          type: 'EXPLAIN',
          title: 'Explain requirements',
          description: 'Understand instructions and eligibility guidelines.',
          icon: 'school-outline',
          isPrimary: !hasDueDate,
        });

        // 3. Chatbot
        actionList.push({
          id: 'action_college_chat',
          type: 'CHAT',
          title: 'Ask EverySense',
          description: 'Ask questions about this notice.',
          icon: 'chatbubble-ellipses-outline',
        });

        // 4. Save
        actionList.push({
          id: 'action_college_save',
          type: 'SAVE',
          title: localSaved ? 'Saved to library ✓' : 'Save document',
          description: 'Keep this notice accessible for future reference.',
          icon: localSaved ? 'bookmark' : 'bookmark-outline',
        });
        break;
      }

      case 'MEDICAL': {
        banner = 'This document appears to contain health information. Consult a healthcare provider for medical advice.';

        stepList.push('Review clinical instructions and dosages carefully');
        stepList.push('Consider setting a follow-up or medication reminder');
        stepList.push('Keep this medical record safely saved for your doctor');

        // 1. Explain simply (Prominent for medical)
        actionList.push({
          id: 'action_med_explain',
          type: 'EXPLAIN',
          title: 'Explain simply',
          description: 'Understand terminology and notes clearly.',
          icon: 'medkit-outline',
          isPrimary: true,
        });

        // 2. Follow-up reminder
        actionList.push({
          id: 'action_med_reminder',
          type: 'CREATE_REMINDER',
          title: 'Set follow-up reminder',
          description: 'Remind me about an appointment or medication.',
          icon: 'alarm-outline',
          metadata: {
            suggestedDateIso: reminderSuggestion?.safeIsoString,
            prefillTitle: `Follow-up: ${docTitle}`,
          },
        });

        // 3. Chatbot
        actionList.push({
          id: 'action_med_chat',
          type: 'CHAT',
          title: 'Ask EverySense',
          description: 'Ask accessibility and health support questions.',
          icon: 'chatbubble-ellipses-outline',
        });

        // 4. Save
        actionList.push({
          id: 'action_med_save',
          type: 'SAVE',
          title: localSaved ? 'Saved to library ✓' : 'Save health record',
          description: 'Keep this medical record saved for reference.',
          icon: localSaved ? 'bookmark' : 'bookmark-outline',
        });
        break;
      }

      case 'RECEIPT': {
        banner = `Receipt for ${docTitle}${hasAmount ? ` totaling ${result.amount}` : ''}.`;

        stepList.push('Save receipt for warranty, tax, or expense tracking');
        stepList.push('Review itemized purchases to verify totals');
        stepList.push('Keep reference IDs handy for returns');

        // 1. Save receipt (Prominent for receipts)
        actionList.push({
          id: 'action_receipt_save',
          type: 'SAVE',
          title: localSaved ? 'Saved to library ✓' : 'Save receipt',
          description: 'Store receipt safely for expense tracking.',
          icon: localSaved ? 'bookmark' : 'receipt-outline',
          isPrimary: true,
        });

        // 2. Explain purchase
        actionList.push({
          id: 'action_receipt_explain',
          type: 'EXPLAIN',
          title: 'Explain purchase',
          description: 'Review itemized breakdown and charges.',
          icon: 'help-circle-outline',
        });

        // 3. Chatbot
        actionList.push({
          id: 'action_receipt_chat',
          type: 'CHAT',
          title: 'Ask EverySense',
          description: 'Ask questions about this purchase.',
          icon: 'chatbubble-ellipses-outline',
        });

        // 4. Return / payment reminder if date detected
        if (hasDueDate) {
          actionList.push({
            id: 'action_receipt_reminder',
            type: 'CREATE_REMINDER',
            title: suggestedDateLabel ? `Set reminder for ${suggestedDateLabel}` : 'Set reminder',
            description: 'Remind me before return window closes.',
            icon: 'alarm-outline',
            metadata: {
              suggestedDateIso: reminderSuggestion?.safeIsoString,
              prefillTitle: `Return window: ${docTitle}`,
            },
          });
        }
        break;
      }

      case 'GENERIC':
      default: {
        banner = 'Here’s what you can do with this information.';

        stepList.push('Review the extracted details and dates');
        stepList.push('Ask EverySense if you need clarification');
        stepList.push('Save for future reference if needed');

        // 1. Explain simply
        actionList.push({
          id: 'action_generic_explain',
          type: 'EXPLAIN',
          title: 'Explain this simply',
          description: 'Understand what this document means.',
          icon: 'document-text-outline',
          isPrimary: true,
        });

        // 2. Chatbot
        actionList.push({
          id: 'action_generic_chat',
          type: 'CHAT',
          title: 'Ask EverySense',
          description: 'Ask questions about this document.',
          icon: 'chatbubble-ellipses-outline',
        });

        // 3. Save
        actionList.push({
          id: 'action_generic_save',
          type: 'SAVE',
          title: localSaved ? 'Saved to library ✓' : 'Save for later',
          description: 'Keep this document available for future reference.',
          icon: localSaved ? 'bookmark' : 'bookmark-outline',
        });
        break;
      }
    }

    return { summaryBanner: banner, steps: stepList, actions: actionList };
  }, [category, result, reminderSuggestion, localSaved]);

  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const handleActionPress = (action: WhatNextAction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (action.type === 'SAVE') {
      setLocalSaved(true);
    }
    onAction(action);
  };

  const primaryAction = useMemo(() => {
    return actions.find(a => a.isPrimary) || actions[0];
  }, [actions]);

  const secondaryActions = useMemo(() => {
    return actions.filter(a => a.id !== primaryAction?.id);
  }, [actions, primaryAction]);

  const stepNumberIcons = ['1', '2', '3', '4', '5'];
  const docTitle = result.title !== 'Not detected' ? result.title : result.documentType;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder },
      ]}
      accessible={false}
    >
      {/* Refined Header */}
      <View style={[styles.headerWrap, { borderBottomColor: theme.cardBorder }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerKicker, { color: theme.accent }]}>WHAT'S NEXT?</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
              What should I do now?
            </Text>
          </View>
          <View style={[styles.docPill, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name="document-outline" size={13} color={theme.accent} style={{ marginRight: 4 }} />
            <Text style={[styles.docPillText, { color: theme.textSecondary }]} numberOfLines={1}>
              {docTitle}
            </Text>
          </View>
        </View>
      </View>

      {/* Context Summary */}
      <View
        style={[
          styles.summaryBox,
          {
            backgroundColor: theme.surfaceSecondary,
            borderColor: theme.cardBorder,
          },
        ]}
      >
        <Text style={[styles.summaryText, { color: theme.textPrimary }]}>
          {summaryBanner}
        </Text>
      </View>

      {/* Steps Plan */}
      <View style={styles.planSection}>
        <Text style={[styles.planSectionLabel, { color: theme.textMuted }]}>
          SUGGESTED STEPS
        </Text>

        <View
          style={[
            styles.stepsContainer,
            {
              backgroundColor: theme.surfaceSecondary,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          {steps.map((step, idx) => (
            <View key={idx} style={styles.stepItemRow}>
              <View style={[styles.stepNumCircle, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.stepNumber, { color: theme.accent }]}>
                  {idx + 1}
                </Text>
              </View>
              <Text style={[styles.stepText, { color: theme.textPrimary }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Actions Section */}
      <View style={styles.actionsSection}>
        {/* Recommended Primary Action */}
        {primaryAction && (
          <View style={styles.primaryActionWrap}>
            <Text style={[styles.actionsSectionLabel, { color: theme.accent }]}>
              RECOMMENDED ACTION
            </Text>
            <TouchableOpacity
              key={primaryAction.id}
              onPress={() => handleActionPress(primaryAction)}
              activeOpacity={0.85}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`${primaryAction.title}. ${primaryAction.description}`}
              style={[
                styles.actionButtonPrimary,
                {
                  backgroundColor: theme.accent,
                },
              ]}
            >
              <Ionicons name={primaryAction.icon as any} size={22} color="#0B1020" style={{ marginRight: 10 }} />
              <View style={styles.actionTextWrap}>
                <Text style={styles.primaryActionTitle}>
                  {primaryAction.title}
                </Text>
                <Text style={styles.primaryActionDesc} numberOfLines={1}>
                  {primaryAction.description}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color="#0B1020" />
            </TouchableOpacity>
          </View>
        )}

        {/* More Options Section */}
        {secondaryActions.length > 0 && (
          <View style={styles.secondaryActionsWrap}>
            <TouchableOpacity
              onPress={() => setShowMoreOptions(prev => !prev)}
              style={[styles.moreOptionsToggleBtn, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}
              accessibilityRole="button"
              accessibilityLabel={showMoreOptions ? "Show fewer options" : "Show more options"}
            >
              <Text style={[styles.moreOptionsToggleText, { color: theme.textPrimary }]}>
                {showMoreOptions ? 'Fewer options' : 'More options'}
              </Text>
              <Ionicons
                name={showMoreOptions ? "chevron-up" : "chevron-down"}
                size={18}
                color={theme.accent}
              />
            </TouchableOpacity>

            {showMoreOptions && (
              <View style={styles.actionButtonsList}>
                {secondaryActions.map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    onPress={() => handleActionPress(action)}
                    activeOpacity={0.78}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`${action.title}. ${action.description}`}
                    style={[
                      styles.actionButtonSecondary,
                      {
                        backgroundColor: theme.surfaceSecondary,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.actionIconWrap,
                        {
                          backgroundColor: theme.accentSoft,
                        },
                      ]}
                    >
                      <Ionicons name={action.icon as any} size={18} color={theme.accent} />
                    </View>
                    <View style={styles.actionTextWrap}>
                      <Text style={[styles.actionTitle, { color: theme.textPrimary }]}>
                        {action.title}
                      </Text>
                      <Text style={[styles.actionDescription, { color: theme.textMuted }]} numberOfLines={1}>
                        {action.description}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Safety Notice Footer */}
      <View style={styles.footerWrap}>
        <Text style={[styles.disclaimerText, { color: theme.textMuted }]}>
          Actions suggested based on document content.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 14,
    marginBottom: 24,
    shadowColor: '#050811',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  headerWrap: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
  },
  headerKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  docPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 160,
  },
  docPillText: {
    fontSize: 11,
    fontWeight: '500',
  },
  summaryBox: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  planSection: {
    marginHorizontal: 18,
    marginTop: 16,
  },
  planSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  stepsContainer: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepNumCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 11,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsSection: {
    marginHorizontal: 18,
    marginTop: 18,
  },
  actionsSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  primaryActionWrap: {
    marginBottom: 10,
  },
  actionButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    minHeight: 56,
  },
  primaryActionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1020',
    letterSpacing: 0.2,
  },
  primaryActionDesc: {
    fontSize: 12,
    color: '#1B243B',
    marginTop: 2,
    fontWeight: '500',
  },
  secondaryActionsWrap: {
    marginTop: 4,
  },
  moreOptionsToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 46,
  },
  moreOptionsToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionButtonsList: {
    marginTop: 10,
    gap: 8,
  },
  actionButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 50,
    gap: 12,
  },
  actionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  actionDescription: {
    fontSize: 12,
    marginTop: 1,
  },
  footerWrap: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 4,
  },
  disclaimerText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
