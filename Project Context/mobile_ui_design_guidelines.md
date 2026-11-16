# InSite Assurance — Mobile UI Design System & Guidelines

> **Target Platform:** React Native (Expo SDK 58, Android & iOS Development Builds)  
> **Brand & Design Alignment:** KPMG Smart Infrastructure Assurance Design System  
> **Author:** Antigravity Mobile Engineering Pair  
> **Status:** Production Reference  

---

## 1. Core Architectural UI Principles

### 1.1 Strict Safe Area Insets (No Static Padding)
- **Rule:** **Never use hardcoded vertical paddings** (such as `paddingTop: 50`, `paddingBottom: 40`, `marginTop: 40`) to clear screen edges, status bars, or home indicator pills.
- **Implementation:** Always import `useSafeAreaInsets` from `react-native-safe-area-context`:
  ```tsx
  import { useSafeAreaInsets } from 'react-native-safe-area-context';

  const insets = useSafeAreaInsets();
  // Safe dynamic calculations:
  paddingTop: Math.max(insets.top + 8, 20),
  paddingBottom: Math.max(insets.bottom + 16, 24),
  ```
- **Root Setup:** The root application is wrapped in `<SafeAreaProvider>` inside [mobile/App.tsx](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/App.tsx). Individual screens then query `useSafeAreaInsets()` to adapt responsively to punch-holes, dynamic islands, notches, and software navbars.

### 1.2 In-Flow Action Buttons (No Dividing Footers)
- **Rule:** **Do not use artificial "button footers"** with dividing borders (`borderTopWidth: 1`, `borderTopColor: '#E2E8F0'`) pinned at the screen bottom.
- **Implementation:** Primary action buttons must be rendered **in-flow as part of the natural page or card content**. When a screen scrolls, the submit button sits naturally at the bottom of the form or card stack with adequate bottom spacing calculated via `insets.bottom`.

### 1.3 Zero Pre-filled Dummy Data (Empty Initial State)
- **Rule:** Input fields, forms, and profiles must **never initialize with dummy or mocked data** (e.g. dummy names, mock phone numbers, or pre-filled license IDs).
- **Implementation:**
  - State variables start empty: `useState('')`.
  - Provide descriptive, helpful placeholder text (e.g. `placeholder="e.g. Engr. Babatunde Adeleke"`, `placeholder="e.g. COREN R.49201"`).
  - Empty states render the standard `<EmptyStateCard>` rather than blank or ambiguous screens.
  - Asynchronous network calls show `<InSiteLoader>` during transit and trigger user-friendly `<ToastBanner>` notifications upon error or completion.

### 1.4 StatusBar Management
- **Rule:** Use `expo-status-bar` rather than React Native's platform-variant `StatusBar`.
- **Implementation:**
  ```tsx
  import { StatusBar } from 'expo-status-bar';

  <StatusBar style="light" />
  ```
  This guarantees consistent transparent light-content status bars across Android edge-to-edge, iOS, and Web.

---

## 2. Brand Color Palette & Design Tokens

### 2.1 Theme Gradient Palette
The visual signature of InSite Assurance features a dark, technical, futuristic mesh gradient flowing from vibrant teal/cyan through KPMG corporate navy into deep indigo, violet, and plum/magenta:

| Color Token | Hex Code | Visual Role |
| :--- | :--- | :--- |
| **Teal / Cyan** | `#0891B2` | Top-left ambient illumination & energetic highlight |
| **KPMG Deep Navy** | `#1E3A8A` | Primary structural brand blue |
| **Cobalt Indigo** | `#4338CA` | Midtone bridge |
| **Deep Violet** | `#581C87` | Rich depth and brand sophistication |
| **Plum / Magenta** | `#831843` | Warm lower gradient accent |
| **Midnight Slate** | `#0F172A` | Base shadow and contrast background |
| **Deep Black** | `#050811` | Bottom terminal anchor |

### 2.2 Content Surface & Neutral Palette
| Token Name | Hex Code | Role |
| :--- | :--- | :--- |
| **Content Background** | `#F8FAFC` | Main body surface below curved gradient headers |
| **Card Surface** | `#FFFFFF` | Form cards, thread items, and dialogs |
| **KPMG Corporate Blue** | `#00338D` | Primary action buttons, badges, and icons |
| **KPMG Cyan** | `#009A44` / `#00A3A6` | Verification checkmarks & status accents |
| **Text Primary** | `#0F172A` | Headings, titles, and high-emphasis body |
| **Text Secondary** | `#475569` | Labels, captions, and metadata |
| **Border Subtle** | `#E2E8F0` | Card borders, dividers, and pill outlines |
| **Border Input** | `#CBD5E1` | Form inputs in unfocused state |
| **Presence Green** | `#10B981` | Online/active presence badge dot |

---

## 3. Screen Layout Archetypes

### 3.1 Landing / Welcome Archetype (`LandingScreen`)
Used as the user's initial touchpoint before profile creation or project onboarding.
```
┌──────────────────────────────────────────────┐
│  [StatusBar: transparent, style="light"]     │
│                                              │
│  [KPMG Logo (small, white)]                  │
│                                              │
│                   ┌─────┐                    │
│                   │ 🛡️  │ [App Logo Badge]    │
│                   └─────┘                    │
│              inSite Assurance                │
│       Independent Capital Project Oversight  │
│                                              │
│         [ Get Started  ──────────> ]         │
│     (White button, Navy text #00338D)        │
│                                              │
└──────────────────────────────────────────────┘
```
- **Component:** [mobile/src/screens/LandingScreen.tsx](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/screens/LandingScreen.tsx)
- **Background:** `<BrandGradient>` wrapping edge-to-edge.
- **Action Button:** Elevated white surface (`#FFFFFF`), bold KPMG navy text (`#00338D`), subtle shadow (`elevation: 4`, `shadowOpacity: 0.2`).

---

### 3.2 Standard Screen Layout (`GradientHeaderLayout`)
Used across all primary workspace screens ([OnboardingProfileScreen](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/screens/OnboardingProfileScreen.tsx), [EnterProjectCodeScreen](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/screens/EnterProjectCodeScreen.tsx), [VerificationUnderReviewScreen](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/screens/VerificationUnderReviewScreen.tsx), [AssuranceCredentialsStep](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/components/assurance/AssuranceCredentialsStep.tsx)).

```
┌──────────────────────────────────────────────┐
│  [StatusBar: transparent, style="light"]     │
│  Gradient Header [Cyan -> Navy -> Violet]    │
│                                              │
│  [← Back / Icon]  Title Here      [Avatar 🟢]│
│                   Subtitle info              │
│  [Optional Filter Pills or Badges]           │
├──────────────────────────────────────────────┤  <-- borderTopLeftRadius: 24, borderTopRightRadius: 24
│  Curved Content Container (#F8FAFC)          │  <-- marginTop: -16 (overlaps gradient seamlessly)
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Form Card or Information Block         │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [Primary In-Flow Action Button]             │
│                                              │
└──────────────────────────────────────────────┘
```

#### Curved Container CSS Rules:
```tsx
curvedContentContainer: {
  flex: 1,
  backgroundColor: '#F8FAFC',
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  marginTop: -16,
  overflow: 'hidden',
}
```

---

### 3.3 List & Chat Stream Archetypes (`WbsInboxScreen`, `WbsChatThreadScreen`)
- **Inbox Header:** Title row with user avatar and online presence indicator (`#10B981` dot), search bar, and horizontal filter chips (`All`, `Active`, `Hold-Points`, `Approved`).
- **Thread Header:** Displays WBS code badge, target quantity, hold point indicator, and quick action icons (Incident modal trigger, Backlog sync).
- **Composer Bar:** Floats directly above the bottom safe area inset:
  ```tsx
  composerBar: {
    paddingBottom: Math.max(insets.bottom, 12),
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  }
  ```

---

## 4. Reusable Component Catalog

All shared visual primitives are exported from [mobile/src/components/common/index.ts](file:///c:/Users/tochi/Documents/Development%20Work/KPMG/inSite%20Assurance/mobile/src/components/common/index.ts):

| Component | Export Path | Usage |
| :--- | :--- | :--- |
| **`BrandGradient`** | `../components/common` | Full-screen dynamic dark gradient background matching brand reference. |
| **`KpmgLogo`** | `../components/common` | Official 4-bar colored badge + crisp KPMG white wordmark. Supports `size="small"` or `"medium"`. |
| **`AppLogo`** | `../components/common` | Glowing glassmorphic shield & checkmark icon for InSite Assurance branding. |
| **`GradientHeaderLayout`** | `../components/common` | Primary screen wrapper with dynamic gradient header, curved body container, and automatic safe area handling. |
| **`InSiteLoader`** | `../components/common` | Centered spinner with branding label for async data fetching. |
| **`ToastBanner`** | `../components/common` | Non-blocking alert banner supporting `info`, `success`, and `error` types with user-friendly messages. |
| **`EmptyStateCard`** | `../components/common` | Friendly illustrative placeholder card when lists or search results are empty. |

---

## 5. Developer Quickstart: Authoring a New Screen

When creating a new screen for InSite Assurance, copy this boilerplate to ensure 100% compliance with these guidelines:

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { GradientHeaderLayout, InSiteLoader } from '../components/common';

interface Props {
  onBack?: () => void;
  onSubmit: (value: string) => void;
}

export const SampleFeatureScreen: React.FC<Props> = ({ onBack, onSubmit }) => {
  // 1. Initial input state starts EMPTY (never pre-filled with dummy data)
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!inputValue.trim()) {
      Alert.alert('Required Field', 'Please provide a valid entry.');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(inputValue.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <GradientHeaderLayout
      title="Feature Title"
      subtitle="Brief helpful explanation of this workflow step"
      leftAction={
        onBack ? (
          <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        ) : undefined
      }
      contentContainerStyle={styles.body}
    >
      {/* 2. Main Form Card */}
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Input Label *</Text>
        <TextInput
          style={styles.input}
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="e.g. Enter required details..."
          placeholderTextColor="#94A3B8"
        />
      </View>

      {/* 3. In-Flow Action Button (NO dividing footer) */}
      <TouchableOpacity
        style={[styles.primaryButton, loading && { opacity: 0.7 }]}
        onPress={handleConfirm}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <InSiteLoader size="sm" color="#FFFFFF" label="Submitting..." />
        ) : (
          <Text style={styles.primaryButtonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </GradientHeaderLayout>
  );
};

const styles = StyleSheet.create({
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  backText: {
    fontSize: 12,
    color: '#93C5FD',
    fontWeight: '700',
  },
  body: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  primaryButton: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00338D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
```

