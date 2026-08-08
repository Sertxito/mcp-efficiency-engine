import os

from scripts.wiki.compiler_main import main


if "AUTODOCS_FORCE_CLEAN" not in os.environ:
    os.environ["AUTODOCS_FORCE_CLEAN"] = "1"


if __name__ == "__main__":
    raise SystemExit(main())