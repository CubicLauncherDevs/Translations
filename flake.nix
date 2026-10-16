{
	description = "CubicLauncher i18n Worker (Cloudflare Workers) — entorno de desarrollo";

	inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

	outputs = { self, nixpkgs }:
		let
			systems = [
				"x86_64-linux"
				"aarch64-linux"
				"x86_64-darwin"
				"aarch64-darwin"
			];
			forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
		in
		{
			devShells = forAllSystems (system:
				let
					pkgs = import nixpkgs { inherit system; };
				in
				{
					default = pkgs.mkShell {
						packages = with pkgs; [
							bun
							nodejs
							git
						];
						shellHook = ''
							echo "CubicLauncher i18n Worker — devShell listo (bun $(bun --version))"
						'';
					};
				});
		};
}
