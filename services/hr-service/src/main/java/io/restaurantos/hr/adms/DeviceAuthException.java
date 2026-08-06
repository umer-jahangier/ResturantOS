package io.restaurantos.hr.adms;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** Device-authentication failure on the JWT-exempt ingest path (unknown/inactive serial, bad token). */
@ResponseStatus(HttpStatus.UNAUTHORIZED)
public class DeviceAuthException extends RuntimeException {

    public DeviceAuthException(String message) {
        super(message);
    }
}
