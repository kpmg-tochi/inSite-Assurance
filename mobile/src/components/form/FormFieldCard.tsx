import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { VisitFormAnswerInput, VisitFormSnapshotBlock, VisitFormSnapshotField } from '@insite/shared';
import type { CaptureRecord } from '../../storage/captureStore';
import type { VoiceRecordingResult } from '../audio';
import { photoFieldModel, unitLabelFor, type FormIssue, type PhoneCaptureFact, type PhotoSlot } from '../../utils/visitForm';
import { commentVisible, fieldRuleNotes, issuesFor, recheckMetaText } from '../../utils/formUiModel';
import { DateAnswerInput } from './DateAnswerInput';
import { MultiChoiceInput } from './MultiChoiceInput';
import { NumberAnswerInput } from './NumberAnswerInput';
import { PhotoSlotsInput } from './PhotoSlotsInput';
import { RatingInput } from './RatingInput';
import { SingleChoiceInput } from './SingleChoiceInput';
import { TextAnswerInput } from './TextAnswerInput';
import { VoiceNoteInput } from './VoiceNoteInput';
import { YesNoInput } from './YesNoInput';
import { formStyles } from './formStyles';

export interface FormFieldCardProps {
  field: VisitFormSnapshotField;
  block: VisitFormSnapshotBlock;
  answer: VisitFormAnswerInput | null;
  /** The issues of this section (the card picks its own). */
  issues: FormIssue[] | undefined;
  facts: Map<string, PhoneCaptureFact>;
  captures: Map<string, CaptureRecord>;
  readOnly: boolean;
  timeZone: string | null;
  onValue: (path: string, value: VisitFormAnswerInput['value']) => void;
  onComment: (path: string, comment: string | null) => void;
  onTakePhoto: (field: VisitFormSnapshotField, slot: PhotoSlot, left: number) => void;
  onRetakePhoto: (field: VisitFormSnapshotField, slot: PhotoSlot, clientCaptureId: string) => void;
  onRemoveCapture: (path: string, clientCaptureId: string) => void;
  onPickFromSiteLog?: (field: VisitFormSnapshotField, slot: PhotoSlot, left: number) => void;
  onVoiceRecorded: (field: VisitFormSnapshotField, result: VoiceRecordingResult) => void;
}

/**
 * One question of the visit form, rendered by its R3 type. Per-unit copies carry their unit's label;
 * re-check items show the finding. The answer's rules show inline: a comment or photo appears when
 * the answer needs one, and a note says when the answer will raise a finding.
 */
export function FormFieldCard(props: FormFieldCardProps) {
  const { field, block, answer, issues, facts, captures, readOnly, timeZone } = props;
  const [commentOpened, setCommentOpened] = useState(false);
  const unitLabel = unitLabelFor(field, block);
  const recheck = field.recheck;
  const question = recheck ? 'Resolved?' : field.label;
  const a11yLabel = [unitLabel, recheck ? `Re-check: ${recheck.title}. Resolved?` : field.label].filter(Boolean).join(', ');
  const value = answer?.value ?? null;
  const notes = fieldRuleNotes(field, answer);
  const photoModel = photoFieldModel(field, answer, facts);
  const own = issuesFor(issues, field.path);
  const set = (v: VisitFormAnswerInput['value']) => props.onValue(field.path, v);
  const isCaptureType = field.type === 'PHOTO' || field.type === 'VOICE_NOTE';
  const showComment = commentVisible(notes, answer, commentOpened);

  let input: React.ReactNode = null;
  switch (field.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
      input = <TextAnswerInput label={a11yLabel} long={field.type === 'LONG_TEXT'} value={value} readOnly={readOnly} onChange={set} />;
      break;
    case 'NUMBER':
    case 'PERCENTAGE':
      input = <NumberAnswerInput field={field} block={block} label={a11yLabel} value={value} readOnly={readOnly} onChange={set} />;
      break;
    case 'YES_NO':
      input = <YesNoInput label={a11yLabel} allowNa={field.allowNa} value={value} readOnly={readOnly} recheck={Boolean(recheck)} onChange={set} />;
      break;
    case 'SINGLE_CHOICE':
      input = <SingleChoiceInput label={a11yLabel} options={field.options} value={value} readOnly={readOnly} onChange={set} />;
      break;
    case 'MULTI_CHOICE':
      input = (
        <MultiChoiceInput label={a11yLabel} options={field.options} minSelected={field.minSelected} maxSelected={field.maxSelected} value={value} readOnly={readOnly} onChange={set} />
      );
      break;
    case 'DATE':
      input = <DateAnswerInput label={a11yLabel} value={value} readOnly={readOnly} timeZone={timeZone} onChange={set} />;
      break;
    case 'RATING_1_5':
      input = (
        <RatingInput
          label={a11yLabel}
          value={value}
          readOnly={readOnly}
          guidanceDefinesScale={Boolean(field.guidance && /\b1\s*=/.test(field.guidance))}
          onChange={set}
        />
      );
      break;
    case 'VOICE_NOTE':
      input = (
        <VoiceNoteInput
          label={a11yLabel}
          required={field.required}
          audio={(answer?.captures ?? []).filter((c) => c.kind === 'AUDIO').map((c) => ({ clientCaptureId: c.clientCaptureId, unitId: c.unitId ?? null, kind: c.kind }))}
          captures={captures}
          readOnly={readOnly}
          timeZone={timeZone}
          onRecorded={(r) => props.onVoiceRecorded(field, r)}
          onRemove={(id) => props.onRemoveCapture(field.path, id)}
        />
      );
      break;
    case 'PHOTO':
      input = null; // the photo slots below are the input
      break;
  }

  return (
    <View style={formStyles.card} testID={`field-${field.path}`}>
      {recheck ? (
        <>
          <Text style={formStyles.unitTag}>Re-check · {recheckMetaText(field)}</Text>
          <Text style={formStyles.label}>{recheck.title}</Text>
          {unitLabel ? <Text style={formStyles.meta}>{unitLabel}</Text> : null}
          {field.guidance ? <Text style={formStyles.meta}>{field.guidance}</Text> : null}
          <Text style={[formStyles.label, { marginTop: 10 }]}>{question}</Text>
        </>
      ) : (
        <>
          {unitLabel ? <Text style={formStyles.unitTag}>{unitLabel}</Text> : null}
          <Text style={formStyles.label} accessibilityRole="header">
            {field.label}
            {!field.required && field.type !== 'PHOTO' ? ' (optional)' : ''}
          </Text>
          {field.guidance ? <Text style={formStyles.meta}>{field.guidance}</Text> : null}
        </>
      )}

      {input}

      {notes.findingNote ? (
        <Text style={formStyles.warningNote} accessibilityLiveRegion="polite">
          ! {notes.findingNote}
        </Text>
      ) : null}

      {photoModel && (
        <>
          {field.type !== 'PHOTO' && notes.photoNeeded ? <Text style={formStyles.warningNote}>This answer needs a photo</Text> : null}
          <PhotoSlotsInput
            label={a11yLabel}
            model={photoModel}
            captures={captures}
            readOnly={readOnly}
            onTake={(slot, left) => props.onTakePhoto(field, slot, left)}
            onRetake={(slot, id) => props.onRetakePhoto(field, slot, id)}
            onRemove={(id) => props.onRemoveCapture(field.path, id)}
            onPick={props.onPickFromSiteLog ? (slot, left) => props.onPickFromSiteLog?.(field, slot, left) : undefined}
          />
        </>
      )}

      {showComment ? (
        <>
          <Text style={[formStyles.meta, notes.commentNeeded && formStyles.warningNote]}>{notes.commentLabel}</Text>
          <TextInput
            style={[formStyles.input, readOnly && formStyles.inputDisabled]}
            multiline
            editable={!readOnly}
            value={answer?.comment ?? ''}
            onChangeText={(t) => props.onComment(field.path, t.length > 0 ? t : null)}
            maxLength={2000}
            placeholder={notes.commentNeeded ? 'Needed' : 'Comment'}
            accessibilityLabel={`${notes.commentLabel}, ${a11yLabel}`}
          />
        </>
      ) : !readOnly && !isCaptureType ? (
        <TouchableOpacity onPress={() => setCommentOpened(true)} accessibilityRole="button" accessibilityLabel={`Add a comment to ${a11yLabel}`}>
          <Text style={formStyles.link}>Add a comment</Text>
        </TouchableOpacity>
      ) : null}

      {own.map((i, n) => (
        <Text key={`${i.code}-${i.unitId ?? ''}-${n}`} style={formStyles.error}>
          To fix: {i.message}
        </Text>
      ))}
    </View>
  );
}
