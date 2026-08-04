package io.restaurantos.inventory.entity;

import java.io.Serializable;
import java.util.UUID;

public record ProcessedEventId(String consumer, UUID eventId) implements Serializable {}
