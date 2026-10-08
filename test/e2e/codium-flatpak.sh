#!/bin/sh
# Runs the Flatpak VSCodium (com.vscodium.codium) as the editor for the end-to-end tests:
#   CODE_EXECUTABLE=test/e2e/codium-flatpak.sh npm run test:e2e
# The .NET SDK must be visible in the sandbox, e.g. via the dotnet10 SDK extension:
#   flatpak install --user flathub org.freedesktop.Sdk.Extension.dotnet10//25.08
#   flatpak override --user --env=FLATPAK_ENABLE_SDK_EXT=dotnet10 com.vscodium.codium
# The Flatpak's own launcher goes through VSCodium's command line client, which hands off to
# the editor and exits; its inner wrapper sets up the SDK and runs the editor in the foreground.
exec flatpak run --command=/app/bin/com.vscodium.codium-wrapper com.vscodium.codium "$@"
