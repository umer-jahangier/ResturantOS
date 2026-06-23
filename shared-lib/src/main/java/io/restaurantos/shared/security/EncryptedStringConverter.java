package io.restaurantos.shared.security;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class EncryptedStringConverter implements AttributeConverter<String, byte[]> {
    private static EncryptionService encryptionService;

    public static void init(EncryptionService svc) {
        encryptionService = svc;
    }

    @Override
    public byte[] convertToDatabaseColumn(String attribute) {
        return encryptionService.encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(byte[] dbData) {
        return encryptionService.decrypt(dbData);
    }
}
