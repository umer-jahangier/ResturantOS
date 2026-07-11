package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.BAD_REQUEST)
public class InvalidPoStateException extends RuntimeException {
    public InvalidPoStateException(String message) {
        super(message);
    }
}
