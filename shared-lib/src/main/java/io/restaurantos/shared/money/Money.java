package io.restaurantos.shared.money;

/** All money in the system is integer paisa (1 PKR = 100 paisa). */
public record Money(long paisa, double pkr, String formatted) {}
