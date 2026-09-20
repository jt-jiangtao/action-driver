package app

import (
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

const (
	DefaultProtocolMajor uint32 = 1
	DefaultProtocolMinor uint32 = 0
)

type Config struct {
	SocketPath    string
	DatabasePath  string
	SessionToken  string
	ProtocolMajor uint32
	ProtocolMinor uint32
}

func ParseConfig(args []string) (Config, error) {
	flags := flag.NewFlagSet("actiondriver-agentd", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	var config Config
	var protocolMajor uint
	var protocolMinor uint
	flags.StringVar(&config.SocketPath, "socket", "", "private Unix domain socket path")
	flags.StringVar(&config.DatabasePath, "database", "", "private SQLite database path")
	flags.StringVar(&config.SessionToken, "session-token", "", "session authentication token")
	flags.UintVar(&protocolMajor, "protocol-major", uint(DefaultProtocolMajor), "runtime protocol major version")
	flags.UintVar(&protocolMinor, "protocol-minor", uint(DefaultProtocolMinor), "runtime protocol minor version")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}

	config.SocketPath = strings.TrimSpace(config.SocketPath)
	config.DatabasePath = strings.TrimSpace(config.DatabasePath)
	config.SessionToken = strings.TrimSpace(config.SessionToken)
	if config.SocketPath == "" || config.DatabasePath == "" {
		return Config{}, fmt.Errorf("socket and database paths are required")
	}
	if !filepath.IsAbs(config.SocketPath) || !filepath.IsAbs(config.DatabasePath) {
		return Config{}, fmt.Errorf("socket and database paths must be absolute")
	}
	if config.SessionToken == "" {
		return Config{}, fmt.Errorf("session token is required")
	}
	if protocolMajor == 0 || protocolMajor > uint(^uint32(0)) || protocolMinor > uint(^uint32(0)) {
		return Config{}, fmt.Errorf("invalid protocol version %d.%d", protocolMajor, protocolMinor)
	}
	config.ProtocolMajor = uint32(protocolMajor)
	config.ProtocolMinor = uint32(protocolMinor)

	return config, nil
}
