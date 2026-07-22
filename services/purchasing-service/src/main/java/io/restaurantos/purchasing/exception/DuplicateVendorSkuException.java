package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** Thrown when a vendor SKU is already used by another catalog row for the same vendor. */
@ResponseStatus(HttpStatus.CONFLICT)
public class DuplicateVendorSkuException extends RuntimeException {
    public DuplicateVendorSkuException(String vendorSku) {
        super("DUPLICATE_VENDOR_SKU: " + vendorSku);
    }
}
