package io.restaurantos.shared.exception;

public class FeatureDisabledException extends RestaurantOsException {
    private final String feature;
    public FeatureDisabledException(String feature) {
        super("FEATURE_DISABLED", "Feature not available on current plan: " + feature);
        this.feature = feature;
    }
    public String getFeature() { return feature; }
}
