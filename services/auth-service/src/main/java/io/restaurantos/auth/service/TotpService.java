package io.restaurantos.auth.service;

import dev.samstevens.totp.code.CodeVerifier;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.code.DefaultCodeVerifier;
import dev.samstevens.totp.qr.QrData;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import org.springframework.stereotype.Service;

@Service
public class TotpService {

    private static final String ISSUER = "RestaurantOS";

    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final CodeVerifier codeVerifier =
        new DefaultCodeVerifier(new DefaultCodeGenerator(), new SystemTimeProvider());

    public String generateSecret() {
        return secretGenerator.generate();
    }

    public String otpauthUri(String secret, String accountName) {
        QrData data = new QrData.Builder()
            .label(accountName)
            .secret(secret)
            .issuer(ISSUER)
            .build();
        return data.getUri();
    }

    public boolean verify(String secret, String code) {
        return codeVerifier.isValidCode(secret, code);
    }
}
