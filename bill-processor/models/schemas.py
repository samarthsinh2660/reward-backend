from pydantic import BaseModel, Field
from typing import Optional, List


class BillItem(BaseModel):
    name: str
    hsn_code: Optional[str] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total_price: Optional[float] = None


class ExtractedBillData(BaseModel):
    platform: Optional[str] = None          # detected platform name (lowercase), "unknown" if unidentifiable
    is_supported_platform: bool = False     # True only if platform is in the active ALLOWED_PLATFORMS list
    order_id: Optional[str] = None
    order_date: Optional[str] = None        # ISO date string YYYY-MM-DD
    merchant_name: Optional[str] = None
    seller_gstin: Optional[str] = None
    fssai_license: Optional[str] = None   # 14-digit FSSAI license number (food business identifier)
    fbo_email: Optional[str] = None       # platform support email (e.g. support@zeptonow.com)
    customer_name: Optional[str] = None   # "Bill To" name — matched against user.name in Node.js
    total_amount: Optional[float] = None
    subtotal: Optional[float] = None
    delivery_fee: Optional[float] = None  # base delivery charge
    handling_fee: Optional[float] = None  # combined platform charges: handling + late night + surge fee
    extra_charges: Optional[float] = None # catch-all for any fee type not yet named (rain fee, peak fee, etc.)
    coupon_code: Optional[str] = None     # coupon/promo code applied (e.g. "ZEPTOSAVE")
    discount: Optional[float] = None      # total discount: coupon discount + membership discount combined
    taxes: Optional[float] = None
    items: List[BillItem] = []
    currency: str = "INR"
    delivery_area: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_state: Optional[str] = None
    delivery_pincode: Optional[str] = None
    place_of_supply: Optional[str] = None
    raw_text_snippet: Optional[str] = None  # first 200 chars of OCR text (debug only)


class FraudSignals(BaseModel):
    tampering_confidence: float = Field(
        0.0,
        ge=0.0, le=1.0,
        description="EXIF/JPEG tampering heuristic confidence (0=clean, 1=tampered)",
    )
    tampering_points: int = Field(
        0,
        description="+35 when tampering_confidence > 0.70",
    )
    rule_violations: List[str] = Field(
        default_factory=list,
        description="List of rule violation codes found in extracted data",
    )
    rule_violation_points: int = Field(
        0,
        description="Sum of points from rule violations",
    )
    fraud_score: int = Field(
        0,
        description="Total fraud score = rule_violation_points + tampering_points",
    )


class ProcessSuccessResponse(BaseModel):
    status: str = "success"
    extracted_data: ExtractedBillData
    image_hash: str = Field(description="SHA-256 hex — exact duplicate detection")
    phash: str = Field(description="Perceptual hash — near-duplicate detection (Hamming ≤ 8)")
    fraud_signals: FraudSignals


class ProcessFailResponse(BaseModel):
    status: str = "failed"
    reason: str = Field(
        description="Machine-readable failure code: quality_low | ocr_failed | parse_failed | invalid_file | not_a_bill",
    )
    message: str = Field(description="Human-readable error message for the client")
