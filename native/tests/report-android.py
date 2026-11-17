from pathlib import Path
import xml.etree.ElementTree as ET

failed = False
for file in Path("native/android/app/build/outputs/androidTest-results").rglob("*.xml"):
    try:
        tree = ET.parse(file)
        for tag in ("failure", "error"):
            for failure in tree.iter(tag):
                failed = True
                message = (failure.text or failure.get("message", ""))[:6000]
                print("::error title=Android installed-app test::" +
                      message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
    except ET.ParseError:
        pass
log = Path("generated-artifacts/android-test.log")
if not failed and log.exists():
    text = log.read_text(errors="replace")
    if "BUILD FAILED" in text:
        print("::error title=Android test build::" +
              text[-6000:].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
