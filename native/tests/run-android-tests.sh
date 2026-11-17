#!/usr/bin/env bash
# One shell invocation: keep the exit status and report collection together.
set +e
# Some emulator images omit the Wi-Fi/telephony service. The APK itself has
# no INTERNET permission regardless of whether these emulator commands exist.
adb shell svc wifi disable || true
adb shell svc data disable || true
mkdir -p generated-artifacts
gradle -p native/android connectedDebugAndroidTest --no-daemon > generated-artifacts/android-test.log 2>&1
result=$?
tail -100 generated-artifacts/android-test.log
python3 native/tests/report-android.py
exit "$result"
