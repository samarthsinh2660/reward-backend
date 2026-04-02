import hashlib
import logging
import imagehash
from PIL import Image
import io

logger = logging.getLogger(__name__)


def compute_sha256(file_bytes: bytes) -> str:
    """Exact duplicate gate — identical files produce identical hash."""
    return hashlib.sha256(file_bytes).hexdigest()


def compute_phash(file_bytes: bytes) -> str:
    """
    Perceptual hash — near-duplicate gate.
    Catches same bill with minor edits (crop, colour, brightness tweak).
    Returns a 16-char hex string. Hamming distance ≤ 8 = near-duplicate.
    """
    try:
        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        result = str(imagehash.phash(img, hash_size=8))
        logger.info(f"phash computed: {result}")
        return result
    except Exception as e:
        logger.error(f"phash failed ({type(e).__name__}): {e}")
        raise


def bytes_to_cv2(file_bytes: bytes):
    """Convert raw bytes to an OpenCV BGR image (numpy array)."""
    import numpy as np
    import cv2
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img
