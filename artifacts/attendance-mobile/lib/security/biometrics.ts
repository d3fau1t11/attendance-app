import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRICS_ENABLED_KEY = 'attendance_biometrics_enabled';

export type BiometricStatus = {
  hasHardware: boolean;
  isEnrolled: boolean;
  biometricType: string;
};

/**
 * Check if the device has biometric hardware and enrolled biometrics.
 */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    let biometricType = 'Biometric Authentication';
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = 'Face ID';
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = 'Fingerprint';
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      biometricType = 'Iris Scan';
    }

    return { hasHardware, isEnrolled, biometricType };
  } catch (err) {
    return { hasHardware: false, isEnrolled: false, biometricType: 'Biometric Authentication' };
  }
}

/**
 * Check if the user has enabled biometric authentication in app settings.
 */
export async function isBiometricsEnabled(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(BIOMETRICS_ENABLED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Enable or disable biometric authentication setting.
 */
export async function setBiometricsEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRICS_ENABLED_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(BIOMETRICS_ENABLED_KEY);
  }
}

/**
 * Prompt the user for biometric authentication (Face ID / Fingerprint).
 */
export async function authenticateBiometric(promptMessage = 'Authenticate to access Attendance'): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use Password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (error) {
    return false;
  }
}
