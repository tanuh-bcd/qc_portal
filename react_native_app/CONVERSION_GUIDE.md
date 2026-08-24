# React Native Conversion Guide

Converting this React web application to React Native involves several key changes. This guide summarizes the steps and provides a blueprint for the conversion.

## 1. Project Setup
Initialize a new React Native project (using Expo or React Native CLI):
```bash
npx create-expo-app tanuh-bcd-mobile
# OR
npx react-native init TanuhBCDMobile
```

## 2. Dependencies
You will need to install mobile-specific versions of the libraries used in the web app:
- `react-navigation` (for routing instead of `react-router-dom`)
- `react-native-safe-area-context`
- `react-native-screens`
- `react-i18next` (works on mobile)
- `react-native-toast-message` (instead of `react-toastify`)
- `@react-native-picker/picker` (for dropdowns)

## 3. Component Mapping
HTML elements must be replaced with React Native components:
- `<div>` -> `<View>`
- `<span>`, `<p>`, `<h1>`, `<h2>` -> `<Text>`
- `<img>` -> `<Image>`
- `<button>` -> `<TouchableOpacity>` or `<Pressable>`
- `<input>` -> `<TextInput>`
- `<ul>`, `<li>` -> `<FlatList>` or mapping with `<View>`
- `<form>` -> No direct equivalent; use state management and handle submission via button press.

## 4. Styling
React Native does not use CSS files. Instead, it uses `StyleSheet.create()` with camelCase properties:
- `background-color` -> `backgroundColor`
- `flex-direction` -> `flexDirection` (default is `column` in RN!)
- Units are unitless (density-independent pixels) instead of `px` or `rem`.

## 5. Assets
Images must be required using `require('./path/to/image.png')` or via URI:
```jsx
<Image source={require('../assets/logo.png')} />
```

## 6. Converted Files
We have provided blueprints for key components in the `react_native_app/` directory:
- `App.js`: Root component with navigation.
- `src/components/Questionnaire.jsx`: Main form logic converted to RN.
- `src/components/QuestionBlock.jsx`: Individual question renderer converted to RN.

## 7. Next Steps
1. Create the React Native project structure.
2. Copy the `assets/locales` folder to the mobile project.
3. Set up `i18n.js` for mobile (similar to web, but without browser language detector).
4. Implement the remaining pages (`LoginPage`, `AdminPage`, etc.) following the patterns in the provided blueprints.
