# Music Discovery Platform

Create a single-page web application that visualizes the semantic model described below, given its entities, attributes, and associated rules. Render a demonstrative example of this semantic model and give interactive means (a toolbar with buttons) to manipulate it according to the actions and rules given.

## Application requirements

- Make this project a simple single-page web application.
- Use vanilla javascript.
- The primary view should be a three.js rendered view that fills the browser window.

## Context

This model represents a digital music discovery platform where users can explore artists and songs and organize songs into playlists.

## Entities

The application should represent the following entities:

1. artists
2. songs
3. playlists

## Entity Attributes

Describe each entity with the following parameters:

- Artist
  - name (text)
  - genre (text)

- Song
  - title (text)
  - duration (number, in seconds)
  - release year (number)
  - genre (text)

- Playlist
  - name (text)
  - number of songs (number)

## Relationships

- an artist has many songs
- a song belongs to one artist
- a playlist contains many songs
- a song can belong to multiple playlists

## Actions

- add a song to a playlist
- remove a song from a playlist
- create a new playlist
- delete a playlist
- play a song
- pause a song

## Rules

- every song must belong to an artist
- a playlist can contain multiple songs
- the same song cannot appear more than once in the same playlist
- only songs already contained in a playlist can be removed from that playlist
- deleting a playlist does not delete its songs
- only one song can be playing at a time
