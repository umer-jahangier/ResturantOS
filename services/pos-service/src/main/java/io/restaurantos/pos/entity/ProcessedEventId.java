package io.restaurantos.pos.entity;

import java.io.Serializable;
import java.util.UUID;

public record ProcessedEventId(String consumer, UUID eventId) implements Serializable {}
