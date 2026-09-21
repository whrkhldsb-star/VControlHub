import unittest
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "harden-freerdp-pin.py"
spec = importlib.util.spec_from_file_location("hardener", SCRIPT)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PinPatchTest(unittest.TestCase):
    def test_native_fingerprint_fallback_is_replaced(self):
        source = "prefix\n" + module.ORIGINAL + "\nsuffix"
        result = module.harden(source)
        self.assertNotIn(module.ORIGINAL, result)
        self.assertIn("verification_status = -1;", result)
        self.assertIn("if (tls->settings->CertificateAcceptedFingerprints)", result)
        self.assertLess(result.index("CertificateAcceptedFingerprints"), result.index("is_accepted(tls"))
        self.assertIn("prefix\n", result)
        self.assertTrue(result.endswith("\nsuffix"))

    def test_unknown_or_duplicate_source_fails_closed(self):
        for source in ["", "changed upstream", module.ORIGINAL + module.ORIGINAL]:
            with self.assertRaises(ValueError):
                module.harden(source)

    def test_reapplying_is_not_silently_accepted(self):
        with self.assertRaises(ValueError):
            module.harden(module.harden(module.ORIGINAL))

if __name__ == "__main__":
    unittest.main()
